'use client';

import {
  formatSalary,
  REMOTE_TYPE_LABELS,
  selectLatestJobs,
  type JobListItemDto,
  type Paginated,
} from '@jobpilot/shared';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Info } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

/**
 * Latest Jobs.
 *
 * The brief asked for "the latest 20–30 jobs". The honest version of that
 * excludes every job whose source did not publish a posting date — a job found
 * today from a dateless board is not a new job, it is one we happened to see
 * today. How many were excluded is shown rather than hidden, because a short
 * list with no explanation looks like a bug.
 */
export default function LatestJobsPage(): React.ReactElement {
  const [keyword, setKeyword] = React.useState('');
  const [applied, setApplied] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setApplied(keyword), 350);
    return () => clearTimeout(timer);
  }, [keyword]);

  const query = useQuery({
    queryKey: ['latest-jobs', applied],
    queryFn: () =>
      apiFetch<Paginated<JobListItemDto>>(
        `/jobs?pageSize=100&sortBy=postedAt&sortOrder=desc${applied ? `&search=${encodeURIComponent(applied)}` : ''}`,
      ),
    placeholderData: (previous) => previous,
  });

  const { items, excludedForUnknownDate } = React.useMemo(
    () => selectLatestJobs(query.data?.items ?? [], 30),
    [query.data],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Latest jobs</h1>
        <p className="text-sm text-muted-foreground">
          The newest roles from sources that publish a real posting date.
        </p>
      </header>

      <Input
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="Filter by keyword, e.g. Python Backend Developer"
        aria-label="Filter latest jobs"
        className="max-w-md"
      />

      {excludedForUnknownDate > 0 ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
        >
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {excludedForUnknownDate} job{excludedForUnknownDate === 1 ? '' : 's'} hidden because their source
            does not publish a posting date. They are still in the Jobs table — they just cannot be ranked by
            how recent they are.
          </span>
        </p>
      ) : null}

      {query.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium">No dated jobs found.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              None of your configured sources published a posting date for these results.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((job, index) => (
            <li key={job.id}>
              <Card>
                <CardContent className="flex flex-wrap items-start gap-4 p-4">
                  <span className="mt-1 w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium leading-snug">{job.title}</h2>
                      {job.relevanceScore !== null ? (
                        <Badge variant={job.relevanceScore >= 65 ? 'success' : 'neutral'}>
                          {job.relevanceScore}% match
                        </Badge>
                      ) : null}
                    </div>

                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {job.companyName}
                      {job.location ? ` · ${job.location}` : ''}
                      {job.remoteType !== 'UNKNOWN' ? ` · ${REMOTE_TYPE_LABELS[job.remoteType]}` : ''}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{job.sourceDisplayName}</Badge>
                      {/* Every job here has a real posted date by construction. */}
                      <span>Posted {formatDate(job.postedAt)}</span>
                      {formatSalary(job.salary) ? <span>· {formatSalary(job.salary)}</span> : null}
                    </div>
                  </div>

                  <Button asChild size="sm" variant="outline">
                    <a href={job.applicationUrl} target="_blank" rel="noopener noreferrer">
                      Apply
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
