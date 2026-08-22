import * as React from 'react';
import { cn } from '@/lib/utils';

/** Placeholder block shown while data loads, sized by the caller. */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
