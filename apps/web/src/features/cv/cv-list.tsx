'use client';

import type { MasterCvSummaryDto } from '@jobpilot/shared';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CvListProps {
  readonly cvs: readonly MasterCvSummaryDto[];
  readonly activeId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onSetDefault: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly isBusy: boolean;
}

export function CvList({
  cvs,
  activeId,
  onSelect,
  onSetDefault,
  onDelete,
  isBusy,
}: CvListProps): React.ReactElement {
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);

  return (
    <ul className="flex flex-col gap-2" aria-label="Your CVs">
      {cvs.map((cv) => {
        const isActive = cv.id === activeId;
        const isConfirming = confirmingId === cv.id;

        return (
          <li
            key={cv.id}
            className={cn(
              'rounded-lg border bg-card p-3 transition-colors',
              isActive ? 'border-primary' : 'border-border',
            )}
          >
            <button
              type="button"
              className="w-full text-left"
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onSelect(cv.id)}
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{cv.title}</span>
                {cv.isDefault ? <Badge variant="default">Default</Badge> : null}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {cv.experienceCount} role{cv.experienceCount === 1 ? '' : 's'} · {cv.skillCount}{' '}
                skill{cv.skillCount === 1 ? '' : 's'}
                {cv.sourceFile ? ` · ${cv.sourceFile.originalName}` : ' · typed in'}
              </span>
            </button>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {cv.isDefault ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => onSetDefault(cv.id)}
                >
                  Make default
                </Button>
              )}

              {isConfirming ? (
                <>
                  {/*
                    Two steps rather than a window.confirm: deleting a CV also
                    deletes the uploaded file, and it cannot be undone.
                  */}
                  <span className="text-xs text-muted-foreground">Delete for good?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => {
                      setConfirmingId(null);
                      onDelete(cv.id);
                    }}
                  >
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => setConfirmingId(cv.id)}
                >
                  Delete
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
