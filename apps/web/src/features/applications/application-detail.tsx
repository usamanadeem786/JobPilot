'use client';

import { APPLICATION_STATUS_LABELS, type ApplicationDto } from '@jobpilot/shared';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatDate } from '@/lib/utils';

interface ApplicationDetailProps {
  readonly application: ApplicationDto | null;
  readonly onClose: () => void;
  readonly onSave: (patch: Record<string, unknown>) => void;
  readonly onDelete: () => void;
  readonly isBusy: boolean;
}

/**
 * One application in full, with its history.
 *
 * The event log is the point of this panel. Statuses tell you where something
 * is now; the log tells you when it got there, which is what someone actually
 * needs when deciding whether an employer has gone quiet.
 */
export function ApplicationDetail({
  application,
  onClose,
  onSave,
  onDelete,
  isBusy,
}: ApplicationDetailProps): React.ReactElement | null {
  const [notes, setNotes] = React.useState('');
  const [interviewAt, setInterviewAt] = React.useState('');
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const applicationId = application?.id ?? null;
  const loadedId = React.useRef<string | null>(null);

  if (applicationId !== loadedId.current) {
    loadedId.current = applicationId;
    setNotes(application?.notes ?? '');
    // The input wants `YYYY-MM-DDTHH:mm`; an ISO string with seconds and a
    // zone is rejected silently and the field renders blank.
    setInterviewAt(application?.interviewAt ? application.interviewAt.slice(0, 16) : '');
    setConfirmingDelete(false);
  }

  if (!application) return null;

  return (
    <div
      role="dialog"
      aria-label={`${application.jobTitle} application`}
      aria-modal="true"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-border bg-background p-5 shadow-xl"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-tight">{application.jobTitle}</h2>
          <p className="text-sm text-muted-foreground">{application.companyName}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          Close
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">{APPLICATION_STATUS_LABELS[application.status]}</Badge>
        {application.appliedAt ? (
          <span className="text-xs text-muted-foreground">
            Sent {formatDate(application.appliedAt)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Not sent yet</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="application-interview">Interview date</Label>
        <Input
          id="application-interview"
          type="datetime-local"
          value={interviewAt}
          onChange={(event) => setInterviewAt(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="application-notes">Notes</Label>
        <Textarea
          id="application-notes"
          rows={5}
          value={notes}
          placeholder="Who you spoke to, what was said, what happens next."
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          disabled={isBusy}
          onClick={() =>
            onSave({
              notes: notes.trim() || null,
              interviewAt: interviewAt ? new Date(interviewAt).toISOString() : null,
            })
          }
        >
          Save
        </Button>

        <Button asChild variant="outline">
          <a href={application.applicationUrl} target="_blank" rel="noopener noreferrer">
            Open posting
          </a>
        </Button>
      </div>

      <section aria-label="History" className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-medium">History</h3>
        {application.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {application.events.map((event) => (
              <li key={event.id} className="text-sm">
                <span className="text-muted-foreground">{formatDate(event.occurredAt)}</span>{' '}
                {event.detail || event.type}
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="mt-auto border-t border-border pt-4">
        {confirmingDelete ? (
          <div className="flex items-center gap-2">
            {/*
              Two steps, because this deletes the record that an application
              was ever made — the one thing on this screen the user cannot
              reconstruct from memory.
            */}
            <span className="text-sm text-muted-foreground">Delete this record?</span>
            <Button variant="destructive" size="sm" disabled={isBusy} onClick={onDelete}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
            Delete this application
          </Button>
        )}
      </div>
    </div>
  );
}
