import * as React from 'react';

/** Text/number field. 28px default; inset shadow marks it as editable. */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'style' | 'prefix'> {
  size?: 'sm' | 'md' | 'lg';
  /** Lucide icon name at the start — "search", "calendar", "hash". */
  iconLeft?: string;
  iconRight?: string;
  /** Static leading text, e.g. a currency symbol. */
  prefix?: React.ReactNode;
  /** Trailing unit, rendered in mono micro-type ("bps", "% NAV"). */
  suffix?: React.ReactNode;
  invalid?: boolean;
  /** Tabular mono figures — use for every numeric input. */
  mono?: boolean;
  fullWidth?: boolean;
  /** Selects the full value on focus, so a click into a pre-filled field replaces it on the next
   *  keystroke instead of appending. Use for any field seeded from an existing value. */
  selectOnFocus?: boolean;
  /** Shows a clear affordance when value is non-empty. */
  onClear?: () => void;
  style?: React.CSSProperties;
}
export const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>>;
