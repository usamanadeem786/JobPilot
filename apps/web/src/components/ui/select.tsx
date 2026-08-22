import * as React from 'react';
import { cn } from '@/lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * A native select. Deliberately not a custom listbox: native selects get
 * keyboard behaviour, screen-reader support and the platform's mobile picker
 * for free, and nothing here needs richer options.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});
