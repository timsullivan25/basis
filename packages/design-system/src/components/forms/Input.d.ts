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
  /** Shows a clear affordance when value is non-empty. */
  onClear?: () => void;
  style?: React.CSSProperties;
}
export function Input(props: InputProps): JSX.Element;
