'use client';

import {
  JobListQuerySchema,
  type JobListItemDto,
  type JobListQuery,
  type JobSearchRequest,
  type TailoredCvDetailDto,
  type JobSearchResultDto,
  type JobSourceStatusDto,
  type Paginated,
} from '@jobpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { JobDetailDrawer } from '@/features/jobs/job-detail';
import { JobSearchPanel } from '@/features/jobs/job-search-panel';
import { JobsTable } from '@/features/jobs/jobs-table';
import { toSearchParams } from '@/features/jobs/query';
import { ApiError, apiFetch, ConfigurationError } from '@/lib/api-client';

/**
 * The jobs dashboard.
 *
 * Query state is the single source of truth and lives here: the table is
 * presentational and reports intent upward, so sorting, filtering and paging
 * all take the same path to the server and cannot drift apart.
 */
export default function JobsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [query, setQuery] = React.useState<JobListQuery>(() => JobListQuerySchema.parse({}));
  const [detailJobId, setDetailJobId] = React.useState<string | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ['job-sources'],
    queryFn: () => apiFetch<JobSourceStatusDto[]>('/jobs/sources'),
    staleTime: 5 * 60 * 1000,
  });

  const analyse = useMutation({
    mutationFn: () =>
      apiFetch<{ analysed: number; skipped: number; degradedReason: string | null }>(
        '/jobs/analyse',
        { method: 'POST', body: {} },
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });

      if (result.analysed === 0) {
        toast.info('Every job already has a score.');
        return;
      }

      toast.success(
        `Scored ${result.analysed} job${result.analysed === 1 ? '' : 's'} against your CV.`,
      );

      // A degraded run is reported separately rather than folded into the
      // success message: the scores are real but they came from keyword
      // counting, and presenting them as an AI reading would overstate them.
      if (result.degradedReason) {
        toast.warning(`Some scores used keyword matching instead: ${result.degradedReason}`);
      }
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const tailor = useMutation({
    mutationFn: (jobId: string) =>
      apiFetch<TailoredCvDetailDto>(`/cv/tailor/${jobId}`, { method: 'POST', body: {} }),
    onSuccess: async (tailored) => {
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success(`CV tailored for ${tailored.jobTitle} at ${tailored.companyName}.`, {
        description: tailored.changeSummary?.notes ?? undefined,
      });
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const trackApplication = useMutation({
    mutationFn: (jobId: string) =>
      apiFetch<{ id: string }>('/applications', { method: 'POST', body: { jobId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['job', detailJobId] });
      await queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success('Tracking this application. Update its status from the Applications page.');
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const findContact = useMutation({
    mutationFn: (jobId: string) =>
      apiFetch<{ found: number; message: string | null }>(`/contacts/discover/${jobId}`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['job', detailJobId] });
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });

      if (result.found === 0) {
        toast.info(result.message ?? 'No published contact in this posting.');
        return;
      }
      toast.success(`Found ${result.found} contact${result.found === 1 ? '' : 's'} in the posting.`);
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const search = useMutation({
    mutationFn: (request: JobSearchRequest) =>
      apiFetch<JobSearchResultDto>('/jobs/search', { method: 'POST', body: request }),
    onSuccess: async (result) => {
      // The newest arrivals are what the user just asked for, so the list is
      // reset to show them rather than leaving them on some later page behind
      // whatever sort and filters happened to be set.
      setQuery((current) => ({ ...current, page: 1, sortBy: 'discoveredAt', sortOrder: 'desc' }));
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });

      if (result.found === 0) {
        toast.info('No jobs matched that search. Try broader keywords or a wider location.');
      } else if (result.addedToUser === 0) {
        toast.info('Every match was already in your list.');
      } else {
        toast.success(`Added ${result.addedToUser} new job${result.addedToUser === 1 ? '' : 's'}.`);
      }
    },
  });

  const jobsQuery = useQuery({
    queryKey: ['jobs', query],
    queryFn: () => apiFetch<Paginated<JobListItemDto>>(`/jobs?${toSearchParams(query)}`),
    // Keeps the previous page visible while the next loads, so paging does not
    // flash an empty table.
    placeholderData: (previous) => previous,
  });

  const updateJob = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch<JobListItemDto>(`/jobs/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['jobs'] }),
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const bulkAction = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ updated: number }>('/jobs/bulk', { method: 'POST', body }),
    onSuccess: (result) => {
      toast.success(`Updated ${result.updated} job${result.updated === 1 ? '' : 's'}.`);
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const onQueryChange = React.useCallback((next: Partial<JobListQuery>) => {
    setQuery((current) => ({ ...current, ...next }));
  }, []);

  const actions = React.useMemo(
    () => ({
      onToggleFavourite: (job: JobListItemDto) =>
        updateJob.mutate({ id: job.id, patch: { isFavourite: !job.isFavourite } }),
      onOpenDetail: (job: JobListItemDto) => setDetailJobId(job.id),
      onGenerateCv: (job: JobListItemDto) => tailor.mutate(job.id),
    }),
    [updateJob, tailor],
  );

  if (jobsQuery.isError) {
    return <JobsError error={jobsQuery.error} onRetry={() => void jobsQuery.refetch()} />;
  }

  const page = jobsQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Every role discovered from your configured sources.
          </p>
        </div>

        <Button
          variant="outline"
          onClick={() => analyse.mutate()}
          disabled={analyse.isPending}
        >
          {analyse.isPending ? 'Scoring…' : 'Score against my CV'}
        </Button>
      </header>

      <JobSearchPanel
        sources={sourcesQuery.data ?? []}
        isSearching={search.isPending}
        result={search.data ?? null}
        error={search.isError ? describeError(search.error) : null}
        onSearch={(request) => search.mutate(request)}
      />

      <JobsTable
        jobs={page?.items ?? []}
        total={page?.meta.total ?? 0}
        page={query.page}
        pageSize={query.pageSize}
        isLoading={jobsQuery.isPending}
        query={query}
        onQueryChange={onQueryChange}
        actions={actions}
        onBulkStatus={(jobIds, status) => bulkAction.mutate({ action: 'set-status', jobIds, status })}
        onBulkGenerateCv={(jobIds) => bulkAction.mutate({ action: 'generate-cv', jobIds })}
      />

      <JobDetailDrawer
        jobId={detailJobId}
        onClose={() => setDetailJobId(null)}
        isTracking={trackApplication.isPending}
        onTrackApplication={(job) => trackApplication.mutate(job.id)}
        isFindingContact={findContact.isPending}
        onFindContact={(job) => findContact.mutate(job.id)}
        contactMessage={findContact.data?.found === 0 ? findContact.data.message : null}
      />
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ConfigurationError || error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

function JobsError({ error, onRetry }: { error: unknown; onRetry(): void }): React.ReactElement {
  // A 404 means the endpoint is not deployed yet — a state of the build, not
  // a failure the user can retry their way out of.
  const notDeployed = error instanceof ApiError && error.code === 'NOT_FOUND';

  if (notDeployed) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-semibold">Job search is not available yet</h1>
        <p className="text-sm text-muted-foreground">
          The job sources, matching and CV tailoring are built and tested, but this deployment has no
          jobs endpoint connected to them yet. Nothing is broken — the feature is not switched on.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
      <div>
        <h1 className="text-lg font-semibold">Could not load jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">{describeError(error)}</p>
      </div>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}
