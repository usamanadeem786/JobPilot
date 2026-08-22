'use client';

import {
  EMPLOYMENT_TYPE_LABELS,
  formatSalary,
  JOB_STATUS_LABELS,
  REMOTE_TYPE_LABELS,
  type JobListItemDto,
} from '@jobpilot/shared';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ExternalLink, FileText, Star } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn, formatDate } from '@/lib/utils';

const helper = createColumnHelper<JobListItemDto>();

/** Status colour carries meaning, so it is defined once rather than inline. */
const STATUS_VARIANT: Record<string, 'default' | 'neutral' | 'success' | 'warning' | 'destructive'> = {
  NEW: 'default',
  SHORTLISTED: 'default',
  CV_GENERATED: 'warning',
  APPLIED: 'warning',
  INTERVIEW: 'success',
  OFFER: 'success',
  REJECTED: 'destructive',
  ARCHIVED: 'neutral',
};

/**
 * Match score colouring. Deliberately coarse: a score is an AI inference, and
 * a fine-grained gradient would imply a precision the number does not have.
 */
function scoreVariant(score: number): 'success' | 'default' | 'warning' | 'neutral' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'default';
  if (score >= 40) return 'warning';
  return 'neutral';
}

export interface JobColumnActions {
  onToggleFavourite(job: JobListItemDto): void;
  onOpenDetail(job: JobListItemDto): void;
  onGenerateCv(job: JobListItemDto): void;
}

export function buildJobColumns(actions: JobColumnActions): ColumnDef<JobListItemDto, unknown>[] {
  return [
    helper.display({
      id: 'select',
      size: 40,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows on this page"
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
          onChange={(event) => table.toggleAllPageRowsSelected(event.target.checked)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select ${row.original.title}`}
          checked={row.getIsSelected()}
          onChange={(event) => row.toggleSelected(event.target.checked)}
        />
      ),
    }),

    helper.accessor('title', {
      header: 'Job title',
      size: 320,
      cell: ({ row }) => (
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => actions.onToggleFavourite(row.original)}
            aria-label={row.original.isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={row.original.isFavourite}
            className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-warning"
          >
            <Star
              className={cn('size-4', row.original.isFavourite && 'fill-warning text-warning')}
              aria-hidden
            />
          </button>
          <button
            type="button"
            onClick={() => actions.onOpenDetail(row.original)}
            className="text-left font-medium leading-snug hover:underline"
          >
            {row.original.title}
          </button>
        </div>
      ),
    }),

    helper.accessor('companyName', {
      header: 'Company',
      size: 180,
      cell: ({ getValue }) => <span className="truncate">{getValue()}</span>,
    }),

    helper.accessor('location', {
      header: 'Location',
      size: 160,
      cell: ({ getValue }) => getValue() ?? <NotStated />,
    }),

    helper.accessor('remoteType', {
      header: 'Remote',
      size: 110,
      cell: ({ getValue }) => {
        const value = getValue();
        // "Not stated" is shown as muted rather than as a real category, so an
        // absent value never reads as an on-site job.
        return value === 'UNKNOWN' ? (
          <NotStated />
        ) : (
          <Badge variant={value === 'REMOTE' ? 'success' : 'neutral'}>
            {REMOTE_TYPE_LABELS[value]}
          </Badge>
        );
      },
    }),

    helper.accessor((row) => row.salary, {
      id: 'salary',
      header: 'Salary',
      size: 170,
      cell: ({ getValue }) => formatSalary(getValue()) ?? <NotStated />,
    }),

    helper.accessor('employmentType', {
      header: 'Type',
      size: 120,
      cell: ({ getValue }) =>
        getValue() === 'UNKNOWN' ? <NotStated /> : EMPLOYMENT_TYPE_LABELS[getValue()],
    }),

    helper.accessor('sourceDisplayName', {
      header: 'Source',
      size: 140,
      cell: ({ getValue }) => <Badge variant="outline">{getValue()}</Badge>,
    }),

    helper.accessor('postedAt', {
      header: 'Posted',
      size: 130,
      cell: ({ row }) =>
        // A discovery time is not a posting time. Labelling it as such would
        // be presenting an inference as a fact.
        row.original.postedAtKnown && row.original.postedAt ? (
          formatDate(row.original.postedAt)
        ) : (
          <span className="text-xs text-muted-foreground" title="This source does not publish posting dates">
            Found {formatDate(row.original.discoveredAt)}
          </span>
        ),
    }),

    helper.accessor('relevanceScore', {
      header: 'Match',
      size: 90,
      cell: ({ getValue }) => {
        const score = getValue();
        if (score === null) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <Badge variant={scoreVariant(score)} title="AI estimate based on your CV">
            {score}%
          </Badge>
        );
      },
    }),

    helper.accessor((row) => row.contact?.name ?? null, {
      id: 'recruiter',
      header: 'Recruiter',
      size: 180,
      cell: ({ row }) => {
        const contact = row.original.contact;
        if (!contact?.name) {
          return <span className="text-xs text-muted-foreground">No verified contact</span>;
        }

        return (
          <div className="flex flex-col">
            <span className="truncate text-sm">{contact.name}</span>
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="truncate text-xs text-primary hover:underline">
                {contact.email}
              </a>
            ) : null}
            {/* Provenance is always visible: a guess must never look verified. */}
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {contact.provenance === 'VERIFIED' ? 'Verified' : 'Unverified'}
              {contact.source ? ` · ${contact.source}` : ''}
            </span>
          </div>
        );
      },
    }),

    helper.accessor('status', {
      header: 'Status',
      size: 130,
      cell: ({ getValue }) => (
        <Badge variant={STATUS_VARIANT[getValue()] ?? 'neutral'}>{JOB_STATUS_LABELS[getValue()]}</Badge>
      ),
    }),

    helper.accessor('hasTailoredCv', {
      header: 'CV',
      size: 80,
      cell: ({ row }) =>
        row.original.hasTailoredCv ? (
          <Badge variant="success">Ready</Badge>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => actions.onGenerateCv(row.original)}>
            <FileText className="size-3.5" aria-hidden />
            Generate
          </Button>
        ),
    }),

    helper.display({
      id: 'apply',
      header: 'Apply',
      size: 120,
      enableHiding: false,
      cell: ({ row }) => (
        <Button asChild size="sm" variant="outline">
          {/* Always the employer's own page: no source shipped today permits
              programmatic submission. */}
          <a
            href={row.original.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Apply for ${row.original.title} at ${row.original.companyName}`}
          >
            Apply
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </Button>
      ),
    }),
  ] as ColumnDef<JobListItemDto, unknown>[];
}

function NotStated(): React.ReactElement {
  return <span className="text-xs text-muted-foreground">Not stated</span>;
}

/** Column labels for the visibility menu, keyed by column id. */
export const JOB_COLUMN_LABELS: Record<string, string> = {
  title: 'Job title',
  companyName: 'Company',
  location: 'Location',
  remoteType: 'Remote',
  salary: 'Salary',
  employmentType: 'Type',
  sourceDisplayName: 'Source',
  postedAt: 'Posted',
  relevanceScore: 'Match',
  recruiter: 'Recruiter',
  status: 'Status',
  hasTailoredCv: 'CV',
};
