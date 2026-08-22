'use client';

import type { DistributionBucket, TimeSeriesPoint } from '@jobpilot/shared';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Charts drawn as inline SVG rather than pulled from a charting library.
 *
 * These are four small, fixed visualisations. A charting library would add a
 * six-figure byte count to the bundle to draw a bar chart, and would still
 * need theming to match the design tokens. Colours come from CSS variables, so
 * dark mode works without a second palette.
 */

export function SparkBars({
  points,
  label,
}: {
  points: readonly TimeSeriesPoint[];
  label: string;
}): React.ReactElement {
  const max = Math.max(1, ...points.map((point) => point.count));
  const width = 100;
  const height = 32;
  const gap = 1;
  const barWidth = points.length > 0 ? (width - gap * (points.length - 1)) / points.length : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${points.reduce((total, point) => total + point.count, 0)} over ${points.length} days`}
      className="h-8 w-full"
    >
      {points.map((point, index) => {
        const barHeight = (point.count / max) * height;
        return (
          <rect
            key={point.date}
            x={index * (barWidth + gap)}
            y={height - barHeight}
            width={barWidth}
            height={Math.max(barHeight, point.count > 0 ? 1 : 0)}
            fill="var(--primary)"
            opacity={point.count > 0 ? 0.85 : 0.15}
          >
            <title>{`${point.date}: ${point.count}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/**
 * A horizontal bar list.
 *
 * Chosen over a pie chart deliberately: comparing angles is harder than
 * comparing lengths, and category labels fit beside bars without a legend.
 */
export function BarList({
  buckets,
  emptyMessage,
  footnote,
}: {
  buckets: readonly DistributionBucket[];
  emptyMessage: string;
  footnote?: string;
}): React.ReactElement {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));

  if (buckets.length === 0 || buckets.every((bucket) => bucket.count === 0)) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {buckets.map((bucket) => (
        <div key={bucket.label} className="flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0 truncate text-muted-foreground" title={bucket.label}>
            {bucket.label}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded-sm bg-muted">
            <div
              className="h-full rounded-sm bg-primary/80"
              style={{ width: `${(bucket.count / max) * 100}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right tabular-nums">{bucket.count}</span>
        </div>
      ))}
      {footnote ? <p className="mt-1 text-xs text-muted-foreground">{footnote}</p> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'success' | 'muted';
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
