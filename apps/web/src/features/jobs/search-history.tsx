'use client';

import type { JobSearchHistoryDto } from '@jobpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiFetch, ConfigurationError } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

/**
 * Searches already run.
 *
 * Called history rather than "saved searches", and the copy says so: nothing
 * here runs on a schedule. Promising a background job the product does not
 * have would leave someone waiting overnight for results that were never
 * going to arrive.
 */
export function SearchHistory(): React.ReactElement {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['job-searches'],
    queryFn: () => apiFetch<JobSearchHistoryDto[]>('/jobs/searches'),
  });

  const rerun = useMutation({
    mutationFn: (entry: JobSearchHistoryDto) =>
      apiFetch<{ found: number; addedToUser: number }>('/jobs/search', {
        method: 'POST',
        body: {
          keywords: entry.name ?? entry.keywords.join(' '),
          ...(typeof entry.filters.location === 'string'
            ? { location: entry.filters.location }
            : {}),
          ...(entry.filters.remoteOnly === true ? { remoteOnly: true } : {}),
          limit: 50,
        },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['job-searches'] });
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success(
        result.addedToUser === 0
          ? 'Nothing new this time.'
          : `Added ${result.addedToUser} new job${result.addedToUser === 1 ? '' : 's'}.`,
      );
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/jobs/searches/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['job-searches'] }),
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const searches = query.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Searches</h1>
        <p className="text-sm text-muted-foreground">
          Every search you have run, and what it found. Run one again to pick up postings added
          since.
        </p>
      </header>

      {query.isError ? (
        <div className="flex flex-col items-start gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <p className="text-sm">{describeError(query.error)}</p>
          <Button onClick={() => void query.refetch()}>Try again</Button>
        </div>
      ) : query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : searches.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">No searches yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Run one from the jobs page and it will be listed here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {searches.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <p className="font-medium">{entry.name ?? entry.keywords.join(' ')}</p>
                <p className="text-sm text-muted-foreground">{describeFilters(entry)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(entry.ranAt)} · found {entry.totalFound}, {entry.totalNew} new
                  {entry.duplicatesRemoved > 0
                    ? `, ${entry.duplicatesRemoved} duplicate${entry.duplicatesRemoved === 1 ? '' : 's'} removed`
                    : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rerun.isPending}
                  onClick={() => rerun.mutate(entry)}
                >
                  {rerun.isPending ? 'Running…' : 'Run again'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(entry.id)}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function describeFilters(entry: JobSearchHistoryDto): string {
  const parts: string[] = [];

  if (typeof entry.filters.location === 'string') parts.push(entry.filters.location);
  if (entry.filters.remoteOnly === true) parts.push('remote only');
  if (entry.sourcesSucceeded.length > 0) parts.push(entry.sourcesSucceeded.join(', '));

  return parts.length > 0 ? parts.join(' · ') : 'Anywhere, all sources';
}

function describeError(error: unknown): string {
  if (error instanceof ConfigurationError || error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
