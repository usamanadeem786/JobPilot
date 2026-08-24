'use client';

import {
  ALLOWED_TRANSITIONS,
  APPLICATION_STATUS_LABELS,
  type ApplicationDto,
  type ApplicationStatus,
} from '@jobpilot/shared';
import { ExternalLink } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';

/** The order the pipeline reads in, left to right. */
const COLUMNS: readonly ApplicationStatus[] = [
  'DRAFT',
  'READY',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
];

interface ApplicationsBoardProps {
  readonly applications: readonly ApplicationDto[];
  readonly onStatusChange: (application: ApplicationDto, status: ApplicationStatus) => void;
  readonly onOpen: (application: ApplicationDto) => void;
  readonly isBusy: boolean;
}

/**
 * The application pipeline.
 *
 * Columns for every status, including the empty ones. A pipeline that hides
 * its empty stages reads as though they do not exist, and the shape of the
 * funnel — how many reached interview against how many were sent — is the
 * thing this screen is for.
 */
export function ApplicationsBoard({
  applications,
  onStatusChange,
  onOpen,
  isBusy,
}: ApplicationsBoardProps): React.ReactElement {
  const byStatus = React.useMemo(() => {
    const groups = new Map<ApplicationStatus, ApplicationDto[]>(
      COLUMNS.map((status) => [status, []]),
    );

    for (const application of applications) {
      groups.get(application.status)?.push(application);
    }

    return groups;
  }, [applications]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((status) => {
        const items = byStatus.get(status) ?? [];

        return (
          <section
            key={status}
            aria-label={APPLICATION_STATUS_LABELS[status]}
            className="flex w-64 shrink-0 flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2"
          >
            <header className="flex items-center justify-between px-1">
              <h2 className="text-sm font-medium">{APPLICATION_STATUS_LABELS[status]}</h2>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </header>

            {items.length === 0 ? (
              <p className="px-1 py-3 text-xs text-muted-foreground">Nothing here.</p>
            ) : (
              items.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  isBusy={isBusy}
                  onStatusChange={onStatusChange}
                  onOpen={onOpen}
                />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function ApplicationCard({
  application,
  onStatusChange,
  onOpen,
  isBusy,
}: {
  application: ApplicationDto;
  onStatusChange: (application: ApplicationDto, status: ApplicationStatus) => void;
  onOpen: (application: ApplicationDto) => void;
  isBusy: boolean;
}): React.ReactElement {
  // Only the moves the server will accept are offered. Showing every status
  // and rejecting the invalid ones afterwards teaches the user nothing about
  // why, and an application that has been sent must not be draggable back to
  // Draft.
  const nextStatuses = ALLOWED_TRANSITIONS[application.status];

  return (
    <article className="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5">
      <button
        type="button"
        className="text-left"
        onClick={() => onOpen(application)}
      >
        <p className="text-sm font-medium leading-tight">{application.jobTitle}</p>
        <p className="text-xs text-muted-foreground">{application.companyName}</p>
      </button>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {application.appliedAt ? <span>Sent {formatDate(application.appliedAt)}</span> : null}
        {application.interviewAt ? (
          <Badge variant="default">Interview {formatDate(application.interviewAt)}</Badge>
        ) : null}
        {application.tailoredCvId ? <Badge variant="neutral">CV attached</Badge> : null}
      </div>

      <div className="flex items-center gap-1.5">
        {nextStatuses.length > 0 ? (
          <Select
            aria-label={`Move ${application.jobTitle}`}
            value=""
            disabled={isBusy}
            onChange={(event) => {
              if (!event.target.value) return;
              onStatusChange(application, event.target.value as ApplicationStatus);
            }}
            className="h-8 text-xs"
          >
            <option value="">Move to…</option>
            {nextStatuses.map((status) => (
              <option key={status} value={status}>
                {APPLICATION_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">Closed</span>
        )}

        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <a
            href={application.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${application.jobTitle} posting`}
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </Button>
      </div>
    </article>
  );
}
