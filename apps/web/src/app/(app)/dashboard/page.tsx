'use client';

import {
  applicationFunnel,
  bySource,
  formatRate,
  scoreDistribution,
  summarise,
  toDailySeries,
  type ApplicationLike,
  type JobListItemDto,
  type Paginated,
  type UserProfileDto,
} from '@jobpilot/shared';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarList, SparkBars, StatCard } from '@/features/analytics/charts';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError, apiFetch } from '@/lib/api-client';

/** True when the endpoint simply is not built on this deployment. */
function isNotDeployed(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'NOT_FOUND';
}

/**
 * The dashboard.
 *
 * Metrics come from the shared analytics functions — the same code the API and
 * the export use — so three places cannot end up disagreeing about what
 * "applications" means.
 */
export default function DashboardPage(): React.ReactElement {
  const { user } = useAuth();

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiFetch<UserProfileDto>('/users/me/profile'),
  });

  const jobsQuery = useQuery({
    queryKey: ['dashboard-jobs'],
    queryFn: () => apiFetch<Paginated<JobListItemDto>>('/jobs?pageSize=100&includeArchived=true'),
  });

  const jobs = React.useMemo(() => jobsQuery.data?.items ?? [], [jobsQuery.data]);

  // Applications have no storage yet, so the pipeline shows its empty state
  // rather than numbers derived from something else and presented as real.
  const applications = React.useMemo<ApplicationLike[]>(() => [], []);

  const summary = React.useMemo(() => summarise(jobs, applications), [jobs, applications]);
  const discovered = React.useMemo(
    () => toDailySeries(jobs.map((job) => job.discoveredAt), { days: 30 }),
    [jobs],
  );
  const scores = React.useMemo(() => scoreDistribution(jobs), [jobs]);
  const sources = React.useMemo(() => bySource(jobs), [jobs]);
  const funnel = React.useMemo(() => applicationFunnel(applications), [applications]);

  const name = profileQuery.data?.fullName ?? user?.email ?? 'there';

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {profileQuery.isPending ? <Skeleton className="h-8 w-64" /> : `Welcome, ${name}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything discovered from your configured sources, at a glance.
        </p>
      </header>

      {/*
        A 404 here means the jobs endpoint is not deployed yet, which is a
        state of the build rather than a fault. Saying so plainly is more
        honest than a red alarm — and than quietly rendering zeroes, which
        would claim there are no jobs when in truth nothing was asked.
      */}
      {jobsQuery.isError ? (
        isNotDeployed(jobsQuery.error) ? (
          <p
            role="status"
            className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
          >
            Job search is not available on this deployment yet, so these figures cover only what has
            been set up so far.
          </p>
        ) : (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {jobsQuery.error instanceof ApiError ? jobsQuery.error.message : 'Could not load your dashboard.'}
          </div>
        )
      ) : null}

      {jobsQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total jobs" value={summary.totalJobs} />
            <StatCard label="New" value={summary.newJobs} />
            <StatCard label="Shortlisted" value={summary.shortlisted} />
            <StatCard label="CVs generated" value={summary.cvsGenerated} />
            <StatCard label="Applications" value={summary.applications} />
            <StatCard label="Interviews" value={summary.interviews} />
            <StatCard label="Offers" value={summary.offers} tone="success" />
            {/* An em dash rather than 0% when there is nothing to divide by:
                "0%" is a claim about performance, and a wrong one. */}
            <StatCard
              label="Interview rate"
              value={formatRate(summary.interviewRate)}
              hint={summary.interviewRate === null ? 'No applications yet' : 'Of applications sent'}
              tone={summary.interviewRate === null ? 'muted' : 'default'}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Jobs discovered, last 30 days</CardTitle>
              </CardHeader>
              <CardContent>
                <SparkBars points={discovered} label="Jobs discovered" />
                <p className="mt-2 text-xs text-muted-foreground">
                  {discovered.reduce((total, point) => total + point.count, 0)} in the last 30 days
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Match score distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  buckets={scores.buckets}
                  emptyMessage="No jobs have been analysed yet."
                  {...(scores.unscored > 0
                    ? {
                        footnote: `${scores.unscored} job${scores.unscored === 1 ? '' : 's'} not yet analysed.`,
                      }
                    : {})}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Jobs by source</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList buckets={sources} emptyMessage="No sources have returned jobs yet." />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Application pipeline</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  buckets={funnel}
                  emptyMessage="No applications tracked yet. Apply to a job to start the pipeline."
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
