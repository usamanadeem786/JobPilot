'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * The small form pieces the CV editor is built from.
 *
 * Kept together because they share one rule: every one of them is a controlled
 * input whose only job is to report a change upward. The editor owns the whole
 * document, so there is a single place where a CV can be modified and a single
 * thing to autosave.
 */

interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly rows?: number;
  readonly hint?: string;
  readonly className?: string;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 4,
  hint,
  className,
}: TextFieldProps): React.ReactElement {
  const id = React.useId();

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface BulletListProps {
  readonly label: string;
  readonly bullets: readonly string[];
  readonly onChange: (bullets: string[]) => void;
  readonly addLabel?: string;
}

/**
 * An editable list of lines.
 *
 * Empty entries are kept while editing rather than pruned on every keystroke:
 * removing a line the moment it is cleared takes the cursor away mid-edit. The
 * editor drops them when it saves.
 */
export function BulletList({
  label,
  bullets,
  onChange,
  addLabel = 'Add a line',
}: BulletListProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>

      {bullets.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing here yet.</p>
      ) : null}

      {bullets.map((bullet, index) => (
        <div key={index} className="flex items-start gap-2">
          <Textarea
            rows={2}
            value={bullet}
            aria-label={`${label} ${index + 1}`}
            onChange={(event) => {
              const next = [...bullets];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${label} ${index + 1}`}
            onClick={() => onChange(bullets.filter((_, position) => position !== index))}
          >
            Remove
          </Button>
        </div>
      ))}

      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...bullets, ''])}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

interface RepeaterProps {
  readonly title: string;
  readonly count: number;
  readonly onAdd: () => void;
  readonly addLabel: string;
  readonly emptyMessage: string;
  readonly children: React.ReactNode;
}

/** A titled section holding a list of entries, with an add button. */
export function Repeater({
  title,
  count,
  onAdd,
  addLabel,
  emptyMessage,
  children,
}: RepeaterProps): React.ReactElement {
  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          {addLabel}
        </Button>
      </div>

      {count === 0 ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : children}
    </section>
  );
}

interface EntryCardProps {
  readonly heading: string;
  readonly onRemove: () => void;
  readonly removeLabel: string;
  readonly children: React.ReactNode;
}

export function EntryCard({
  heading,
  onRemove,
  removeLabel,
  children,
}: EntryCardProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">{heading}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={removeLabel}>
          Remove
        </Button>
      </div>
      {children}
    </div>
  );
}
