'use client';

import {
  describeSearchResult,
  type JobSearchRequest,
  type JobSearchResultDto,
  type JobSourceStatusDto,
} from '@jobpilot/shared';
import { Loader2, Search } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface JobSearchPanelProps {
  readonly sources: readonly JobSourceStatusDto[];
  readonly isSearching: boolean;
  readonly result: JobSearchResultDto | null;
  readonly error: string | null;
  readonly onSearch: (request: JobSearchRequest) => void;
}

/**
 * Find new jobs from the configured boards.
 *
 * This is not the filter box in the table below it, and the difference is the
 * whole reason this panel is a distinct, visually separate block with its own
 * heading. The filter narrows jobs already stored; this goes out over the
 * network to every configured source and brings back postings the account has
 * never seen. A user who types into the wrong one sits waiting for new jobs
 * that were never requested.
 */
export function JobSearchPanel({
  sources,
  isSearching,
  result,
  error,
  onSearch,
}: JobSearchPanelProps): React.ReactElement {
  const [keywords, setKeywords] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [remoteOnly, setRemoteOnly] = React.useState(false);

  const configured = sources.filter((source) => source.isConfigured);
  const unavailable = sources.filter((source) => !source.isConfigured);
  const canSearch = keywords.trim().length > 0 && configured.length > 0 && !isSearching;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSearch) return;

    onSearch({
      keywords: keywords.trim(),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(remoteOnly ? { remoteOnly: true } : {}),
      limit: 50,
    });
  };

  return (
    <section
      aria-label="Find new jobs"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div>
        <h2 className="text-base font-semibold">Find new jobs</h2>
        <p className="text-sm text-muted-foreground">
          Searches {describeSources(configured)} and adds what it finds to your list below.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
          <Label htmlFor="search-keywords">What are you looking for?</Label>
          <Input
            id="search-keywords"
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            placeholder="Backend engineer"
            autoComplete="off"
          />
        </div>

        <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <Label htmlFor="search-location">Where?</Label>
          <Input
            id="search-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="London, or Remote"
            autoComplete="off"
            disabled={remoteOnly}
          />
        </div>

        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={remoteOnly}
            onChange={(event) => setRemoteOnly(event.target.checked)}
          />
          Remote only
        </label>

        <Button type="submit" disabled={!canSearch}>
          {isSearching ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Searching…
            </>
          ) : (
            <>
              <Search className="size-4" aria-hidden />
              Search
            </>
          )}
        </Button>
      </form>

      {/*
        A search can take a while: every configured board is fetched in turn,
        politely rate limited. Saying so beats a spinner that looks stuck.
      */}
      {isSearching ? (
        <p role="status" className="text-sm text-muted-foreground">
          Fetching from {configured.length} source{configured.length === 1 ? '' : 's'}. This takes a
          few seconds — the boards are queried one at a time and rate limited.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {result && !isSearching ? <SearchOutcome result={result} /> : null}

      {configured.length === 0 ? (
        <p
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm"
        >
          No job source is configured on this deployment, so there is nothing to search yet. A
          source needs its credentials set in the server environment before it can be used.
        </p>
      ) : unavailable.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Not searched: {unavailable.map((source) => source.name).join(', ')} — each needs
          credentials that are not set on this deployment.
        </p>
      ) : null}
    </section>
  );
}

/** What the run did, in the terms a person actually cares about. */
function SearchOutcome({ result }: { result: JobSearchResultDto }): React.ReactElement {
  return (
    <div role="status" className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
      <p>{describeSearchResult(result)}</p>

      {result.duplicatesRemoved > 0 ? (
        <p className="text-xs text-muted-foreground">
          {result.duplicatesRemoved} duplicate{result.duplicatesRemoved === 1 ? '' : 's'} removed —
          the same posting listed on more than one board.
        </p>
      ) : null}

      {/*
        A source that failed is reported, never folded into the total. A run
        that says "found 20" while one board was silently down is worse than
        one that admits it: the user concludes those jobs do not exist.
      */}
      {result.sourcesFailed.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {result.sourcesFailed.map((failure) => (
            <li key={failure.sourceKey} className="text-xs text-destructive">
              {failure.sourceKey} could not be reached: {failure.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function describeSources(configured: readonly JobSourceStatusDto[]): string {
  if (configured.length === 0) return 'no configured sources';
  if (configured.length === 1) return configured[0]?.name ?? 'one source';
  if (configured.length === 2) return configured.map((source) => source.name).join(' and ');

  return `${configured.length} job boards`;
}
