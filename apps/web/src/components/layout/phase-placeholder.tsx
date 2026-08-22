import { Construction } from 'lucide-react';
import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * An honest empty state for a screen whose feature has not shipped yet.
 *
 * The navigation links here rather than to a 404, and the page says plainly
 * what will appear and when, instead of showing invented sample data.
 */
export function PhasePlaceholder({
  title,
  phase,
  description,
  willInclude,
}: {
  title: string;
  phase: string;
  description: string;
  willInclude: readonly string[];
}): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>

      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
            <Construction className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <div>
            <CardTitle className="text-base">Arriving in {phase}</CardTitle>
            <CardDescription>This screen has no data to show yet.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm font-medium">What this page will do</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            {willInclude.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
