'use client';

import * as React from 'react';

export type SaveState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'saving' }
  | { status: 'saved'; at: number }
  | { status: 'error'; message: string };

interface AutosaveOptions<T> {
  readonly value: T;
  readonly onSave: (value: T) => Promise<void>;
  readonly delayMs?: number;
  /** Autosave is off until the editor has loaded a document. */
  readonly enabled?: boolean;
}

interface Autosave {
  readonly state: SaveState;
  /** Saves immediately, cancelling any pending timer. */
  readonly saveNow: () => Promise<void>;
  readonly hasUnsavedChanges: boolean;
}

/**
 * Saves a value a short while after it stops changing.
 *
 * Two things this deliberately does not do. It does not save the first value
 * it sees — mounting the editor should not write to the database. And it does
 * not run two saves at once: a save in flight parks the next one until it
 * finishes, so a slow response cannot land after a newer one and overwrite it.
 */
export function useAutosave<T>({
  value,
  onSave,
  delayMs = 1200,
  enabled = true,
}: AutosaveOptions<T>): Autosave {
  const [state, setState] = React.useState<SaveState>({ status: 'idle' });

  // Refs rather than state: these coordinate the effect and must not
  // themselves cause a render.
  const latest = React.useRef(value);
  const savedSnapshot = React.useRef<string | null>(null);
  const inFlight = React.useRef(false);
  const queued = React.useRef(false);
  const onSaveRef = React.useRef(onSave);

  latest.current = value;
  onSaveRef.current = onSave;

  const serialised = React.useMemo(() => JSON.stringify(value), [value]);

  // The first value seen is the baseline, not an edit.
  React.useEffect(() => {
    if (!enabled) return;
    savedSnapshot.current ??= serialised;
  }, [enabled, serialised]);

  const flush = React.useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }

    const snapshot = JSON.stringify(latest.current);
    if (snapshot === savedSnapshot.current) return;

    inFlight.current = true;
    setState({ status: 'saving' });

    try {
      await onSaveRef.current(latest.current);
      savedSnapshot.current = snapshot;
      setState({ status: 'saved', at: Date.now() });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not save your changes.',
      });
    } finally {
      inFlight.current = false;

      // Something changed while the request was out. Save again so the last
      // edit is not silently left behind.
      if (queued.current) {
        queued.current = false;
        void flush();
      }
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    if (savedSnapshot.current === null || serialised === savedSnapshot.current) return;

    setState((current) => (current.status === 'saving' ? current : { status: 'pending' }));

    const timer = setTimeout(() => void flush(), delayMs);
    return () => clearTimeout(timer);
  }, [serialised, delayMs, enabled, flush]);

  const hasUnsavedChanges = savedSnapshot.current !== null && serialised !== savedSnapshot.current;

  // Leaving with edits still in the debounce window would lose them.
  React.useEffect(() => {
    if (!hasUnsavedChanges) return;

    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);

  return { state, saveNow: flush, hasUnsavedChanges };
}

/** Human wording for the save indicator. */
export function describeSaveState(state: SaveState): string {
  switch (state.status) {
    case 'idle':
      return '';
    case 'pending':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return state.message;
  }
}
