'use client';

import {
  APPLICATION_STATUS_LABELS,
  applicationFunnel,
  summarise,
  formatRate,
  type ApplicationDto,
} from '@jobpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/features/analytics/charts';
import { ApiError, apiFetch, ConfigurationError } from '@/lib/api-client';
import { ApplicationsBoard } from './applications-board';
import { ApplicationDetail } from './application-detail';

/**
 * The applications screen.
 *
 * Applications are created from a job, not here — there is nothing to apply
 * to without one — so an empty board points at the jobs page rather than
 * offering a "new application" button that would have nothing to attach to.
 */
export function ApplicationsWorkspace(): React.ReactElement {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['applications'],
    queryFn: () => apiFetch<ApplicationDto[]>('/applications'),
  });

  const applications = React.useMemo(() => query.data ?? [], [query.data]);

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch<ApplicationDto>(`/applications/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['applications'] });
      // The jobs table shows the same status, so it must not be left stale.
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/applications/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setOpenId(null);
      await queryClient.invalidateQueries({ queryKey: ['applications'] });
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success('Application removed.');
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const summary = React.useMemo(() => summarise([], applications), [applications]);
  const funnel = React.useMemo(() => applicationFunnel(applications), [applications]);
  const open = applications.find((application) => application.id === openId) ?? null;

  if (query.isError) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <div>
          <h1 className="text-lg font-semibold">Could not load your applications</h1>
          <p className="mt-1 text-sm text-muted-foreground">{describeError(query.error)}</p>
        </div>
        <Button onClick={() => void query.refetch()}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
        <p className="text-sm text-muted-foreground">
          Every role you have applied to, and where each one stands.
        </p>
      </header>

      {query.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : applications.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">No applications tracked yet</h2>
          <p className="text-sm text-muted-foreground">
            Open a job and start an application from there — an application is always attached to a
            specific role.
          </p>
          <Button asChild variant="outline">
            <a href="/jobs">Go to jobs</a>
          </Button>
        </div>
      ) : (
        <>
          <section aria-label="Pipeline summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Applications" value={summary.applications} />
            <StatCard label="Interviews" value={summary.interviews} />
            <StatCard label="Offers" value={summary.offers} tone="success" />
            {/* An em dash, not 0%, when nothing has been sent: "0%" is a claim
                about performance and a false one. */}
            <StatCard
              label="Interview rate"
              value={formatRate(summary.interviewRate)}
              hint={summary.interviewRate === null ? 'No applications sent yet' : 'Of applications sent'}
              tone={summary.interviewRate === null ? 'muted' : 'default'}
            />
          </section>

          <ApplicationsBoard
            applications={applications}
            isBusy={update.isPending || remove.isPending}
            onOpen={(application) => setOpenId(application.id)}
            onStatusChange={(application, status) => {
              update.mutate(
                { id: application.id, patch: { status } },
                {
                  onSuccess: () =>
                    toast.success(
                      `${application.jobTitle} moved to ${APPLICATION_STATUS_LABELS[status]}.`,
                    ),
                },
              );
            }}
          />

          <p className="text-xs text-muted-foreground">
            {funnel.map((stage) => `${stage.label}: ${stage.count}`).join(' · ')}
          </p>
        </>
      )}

      <ApplicationDetail
        application={open}
        onClose={() => setOpenId(null)}
        onSave={(patch) => open && update.mutate({ id: open.id, patch })}
        onDelete={() => open && remove.mutate(open.id)}
        isBusy={update.isPending || remove.isPending}
      />
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ConfigurationError || error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
