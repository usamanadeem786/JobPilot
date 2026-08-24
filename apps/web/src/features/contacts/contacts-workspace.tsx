'use client';

import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiFetch, ConfigurationError } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

interface ContactDto {
  readonly id: string;
  readonly companyName: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly role: string;
  readonly email: string | null;
  readonly profileUrl: string | null;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly confidence: number;
  readonly provenance: string;
  readonly emailProvenance: string;
  readonly discoveredAt: string;
}

/**
 * Hiring contacts found in job postings.
 *
 * Every row says where it came from. That is the whole design: a name and an
 * address with no provenance invites the user to trust it, and the one thing
 * this feature must never do is present a guess as a verified fact. Nothing
 * here is inferred — addresses are only ever read from what an employer
 * published, never constructed from a name and a domain.
 */
export function ContactsWorkspace(): React.ReactElement {
  const query = useQuery({
    queryKey: ['contacts'],
    queryFn: () => apiFetch<ContactDto[]>('/contacts'),
  });

  const contacts = query.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground">
          Hiring contacts an employer published in a job posting. Open a job and use &ldquo;Find
          contact&rdquo; to look for one.
        </p>
      </header>

      <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Addresses are never guessed from a name and a company domain. Only details an employer
        published are stored, and each one shows its source so you can check it yourself.
      </p>

      {query.isError ? (
        <div className="flex flex-col items-start gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <p className="text-sm">{describeError(query.error)}</p>
          <Button onClick={() => void query.refetch()}>Try again</Button>
        </div>
      ) : query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : contacts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">No contacts found yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Most postings name no one. When one does, it will appear here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{contact.fullName}</p>
                  <p className="text-sm text-muted-foreground">
                    {[contact.title, contact.companyName].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <ProvenanceBadge provenance={contact.provenance} />
              </div>

              {contact.email ? (
                <p className="text-sm">
                  <a className="underline underline-offset-4" href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>{' '}
                  <ProvenanceBadge provenance={contact.emailProvenance} />
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No published address.</p>
              )}

              <p className="text-xs text-muted-foreground">
                Found in {contact.source} on {formatDate(contact.discoveredAt)}
                {contact.sourceUrl ? (
                  <>
                    {' · '}
                    <a
                      className="underline underline-offset-4"
                      href={contact.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      see the posting
                    </a>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * How sure we are, in words.
 *
 * Deliberately not a percentage. A number invites the reader to treat it as a
 * measurement; these are categories, and the difference between "the employer
 * published this" and "we could not confirm it" is what matters.
 */
function ProvenanceBadge({ provenance }: { provenance: string }): React.ReactElement | null {
  switch (provenance) {
    case 'VERIFIED':
      return <Badge variant="success">Confirmed by two sources</Badge>;
    case 'KNOWN':
      return <Badge variant="default">Published by the employer</Badge>;
    case 'AI_INFERENCE':
      return <Badge variant="warning">Inferred — check before using</Badge>;
    case 'NOT_FOUND':
      return <Badge variant="neutral">Not found</Badge>;
    default:
      return null;
  }
}

function describeError(error: unknown): string {
  if (error instanceof ConfigurationError || error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
