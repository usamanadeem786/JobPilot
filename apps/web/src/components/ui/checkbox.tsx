import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Renders the dash state used for a partially selected page. */
  indeterminate?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, indeterminate = false, ...props },
  forwardedRef,
) {
  const innerRef = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement);

  // `indeterminate` exists only as a DOM property, never as an attribute, so
  // React cannot set it declaratively.
  React.useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={innerRef}
      type="checkbox"
      className={cn('size-4 shrink-0 cursor-pointer rounded border-input accent-primary', className)}
      {...props}
    />
  );
});
