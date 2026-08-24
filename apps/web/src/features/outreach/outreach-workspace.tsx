'use client';

import { OUTREACH_STATUS_LABELS, type OutreachDraftDto } from '@jobpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiFetch, ConfigurationError } from '@/lib/api-client';

/**
 * Outreach drafts.
 *
 * Nothing on this screen sends anything. A draft is written, read, edited,
 * approved, and then the user sends it from their own mail client and records
 * that they did. There is no bulk approve and no bulk send — twenty drafts
 * take twenty approvals, which is the difference between helping someone write
 * to twenty people and mailing twenty strangers on their behalf.
 */
export function OutreachWorkspace(): React.ReactElement {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['outreach'],
    queryFn: () => apiFetch<OutreachDraftDto[]>('/outreach'),
  });

  const transport = useQuery({
    queryKey: ['outreach-transport'],
    queryFn: () => apiFetch<{ configured: boolean; note: string }>('/outreach/transport'),
    staleTime: Infinity,
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'sent' }) =>
      apiFetch<OutreachDraftDto>(`/outreach/${id}/${action}`, { method: 'POST', body: {} }),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['outreach'] });
      toast.success(variables.action === 'approve' ? 'Approved.' : 'Recorded as sent.');
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const save = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch<OutreachDraftDto>(`/outreach/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['outreach'] });
      toast.success('Saved. Editing an approved message returns it to draft.');
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/outreach/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setOpenId(null);
      await queryClient.invalidateQueries({ queryKey: ['outreach'] });
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const drafts = query.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Outreach</h1>
        <p className="text-sm text-muted-foreground">
          Introductions to hiring contacts. Draft one from a contact found on a job.
        </p>
      </header>

      {transport.data ? (
        <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {transport.data.note}
        </p>
      ) : null}

      {query.isError ? (
        <div className="flex flex-col items-start gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <p className="text-sm">{describeError(query.error)}</p>
          <Button onClick={() => void query.refetch()}>Try again</Button>
        </div>
      ) : query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : drafts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">No drafts yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Find a contact on a job first, then draft an introduction to them.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((draft) => (
            <li key={draft.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {draft.contactName ?? draft.contactEmail ?? 'Unnamed contact'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {draft.jobTitle} · {draft.companyName}
                  </p>
                </div>
                <Badge
                  variant={
                    draft.status === 'SENT'
                      ? 'success'
                      : draft.status === 'APPROVED'
                        ? 'default'
                        : 'neutral'
                  }
                >
                  {OUTREACH_STATUS_LABELS[draft.status]}
                </Badge>
              </div>

              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{draft.body}</p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpenId(openId === draft.id ? null : draft.id)}>
                  {openId === draft.id ? 'Hide' : 'Read and edit'}
                </Button>

                {/*
                  Approve and send are separate buttons and separate steps.
                  Folding approval into sending would make it a formality
                  rather than the decision the whole feature is built around.
                */}
                {draft.status === 'DRAFT' ? (
                  <Button
                    size="sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ id: draft.id, action: 'approve' })}
                  >
                    Approve
                  </Button>
                ) : null}

                {draft.status === 'APPROVED' ? (
                  <Button
                    size="sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ id: draft.id, action: 'sent' })}
                  >
                    I sent this
                  </Button>
                ) : null}

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(draft.id)}
                >
                  Delete
                </Button>
              </div>

              {openId === draft.id ? (
                <DraftEditor
                  draft={draft}
                  isBusy={save.isPending}
                  onSave={(patch) => save.mutate({ id: draft.id, patch })}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DraftEditor({
  draft,
  onSave,
  isBusy,
}: {
  draft: OutreachDraftDto;
  onSave: (patch: Record<string, unknown>) => void;
  isBusy: boolean;
}): React.ReactElement {
  const [subject, setSubject] = React.useState(draft.subject);
  const [body, setBody] = React.useState(draft.body);

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`subject-${draft.id}`}>Subject</Label>
        <Input
          id={`subject-${draft.id}`}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`body-${draft.id}`}>Message</Label>
        <Textarea
          id={`body-${draft.id}`}
          rows={10}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={isBusy}
          onClick={() => onSave({ subject: subject.trim(), body: body.trim() })}
        >
          Save
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
            toast.success('Copied. Send it from your own mail client.');
          }}
        >
          Copy
        </Button>

        {draft.contactEmail ? (
          <Button asChild variant="ghost" size="sm">
            <a
              href={`mailto:${draft.contactEmail}?subject=${encodeURIComponent(
                subject,
              )}&body=${encodeURIComponent(body)}`}
            >
              Open in mail app
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ConfigurationError || error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
