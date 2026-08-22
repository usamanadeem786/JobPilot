'use client';

import {
  EMPLOYMENT_TYPE_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  formatSalary,
  REMOTE_TYPE_LABELS,
  type JobDetailDto,
} from '@jobpilot/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, Info, X } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

/**
 * The job detail drawer.
 *
 * The analysis panel is the delicate part: a percentage looks authoritative
 * whatever caption sits beside it, so how the score was produced is stated
 * plainly rather than in a tooltip, and the method — a language model's
 * reading or a keyword count — is always named.
 */
export function JobDetailDrawer({
  jobId,
  onClose,
}: {
  jobId: string | null;
  onClose(): void;
}): React.ReactElement | null {
  const detail = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => apiFetch<JobDetailDto>(`/jobs/${jobId ?? ''}`),
    enabled: jobId !== null,
  });

  // Escape closes, which is the behaviour anyone expects from an overlay.
  React.useEffect(() => {
    if (jobId === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [jobId, onClose]);

  if (jobId === null) return null;

  const job = detail.data;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Job details">
      <button type="button" aria-label="Close job details" className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-border bg-background shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-background/95 p-5 backdrop-blur">
          <div className="min-w-0">
            {detail.isPending ? (
              <Skeleton className="h-6 w-72" />
            ) : (
              <>
                <h2 className="text-lg font-semibold leading-snug">{job?.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {job?.companyName}
                  {job?.location ? ` · ${job.location}` : ''}
                </p>
              </>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        {detail.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : detail.isError || !job ? (
          <p className="p-5 text-sm text-destructive">Could not load this job.</p>
        ) : (
          <div className="flex flex-col gap-6 p-5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{job.sourceDisplayName}</Badge>
              {job.remoteType !== 'UNKNOWN' ? (
                <Badge variant={job.remoteType === 'REMOTE' ? 'success' : 'neutral'}>
                  {REMOTE_TYPE_LABELS[job.remoteType]}
                </Badge>
              ) : null}
              {job.employmentType !== 'UNKNOWN' ? (
                <Badge>{EMPLOYMENT_TYPE_LABELS[job.employmentType]}</Badge>
              ) : null}
              {job.experienceLevel !== 'UNKNOWN' ? (
                <Badge>{EXPERIENCE_LEVEL_LABELS[job.experienceLevel]}</Badge>
              ) : null}
              {formatSalary(job.salary) ? <Badge variant="success">{formatSalary(job.salary)}</Badge> : null}
            </div>

            <p className="text-xs text-muted-foreground">
              {job.postedAtKnown && job.postedAt
                ? `Posted ${formatDate(job.postedAt)}`
                : `Discovered ${formatDate(job.discoveredAt)} — this source does not publish posting dates`}
            </p>

            {job.analysis ? <AnalysisPanel analysis={job.analysis} /> : null}

            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Job description
              </h3>
              {/* Rendered as text, never as HTML: the description is
                  third-party content and injecting it would be an XSS hole. */}
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{job.description}</div>
            </section>

            <div className="sticky bottom-0 flex gap-2 border-t border-border bg-background/95 py-4 backdrop-blur">
              <Button asChild>
                <a href={job.applicationUrl} target="_blank" rel="noopener noreferrer">
                  Apply on {job.sourceDisplayName}
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisPanel({ analysis }: { analysis: NonNullable<JobDetailDto['analysis']> }): React.ReactElement {
  const method = (analysis as { method?: string }).method ?? 'llm';

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Match analysis</h3>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold tabular-nums">{analysis.score}%</span>
          <Badge variant={analysis.score >= 65 ? 'success' : analysis.score >= 45 ? 'warning' : 'neutral'}>
            {analysis.recommendation.replace(/_/g, ' ').toLowerCase()}
          </Badge>
        </div>
      </div>

      {/* Stated in the panel, not a tooltip: a percentage reads as
          authoritative no matter what caption sits beside it. */}
      <p className="mb-3 flex items-start gap-1.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {method === 'heuristic'
            ? 'Estimated by counting skill keywords against your CV. No AI provider is configured, so this has not been read in context.'
            : 'Estimated by an AI model reading your CV against this description. An inference, not a verified assessment.'}
        </span>
      </p>

      <p className="mb-4 text-sm leading-relaxed">{analysis.reason}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <SkillList
          title="Evidenced in your CV"
          items={analysis.matchingSkills}
          tone="match"
          empty="None of the recognised requirements appear in your CV."
        />
        <SkillList
          title="Not evidenced"
          items={analysis.missingSkills}
          tone="miss"
          empty="Nothing the description asks for is missing."
        />
      </div>

      {analysis.matchingExperience.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Relevant experience
          </h4>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {analysis.matchingExperience.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SkillList({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: readonly string[];
  tone: 'match' | 'miss';
  empty: string;
}): React.ReactElement {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item}>
              <Badge variant={tone === 'match' ? 'success' : 'neutral'}>
                {tone === 'match' ? (
                  <Check className="size-3" aria-hidden />
                ) : (
                  <X className="size-3" aria-hidden />
                )}
                {item}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
