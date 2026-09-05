import * as React from 'react';

export interface SelectOption { value: string; label: string; disabled?: boolean }

/** Dropdown for 4+ mutually exclusive options; below that use SegmentedControl. */
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'style'> {
  options?: SelectOption[];
  size?: 'sm' | 'md' | 'lg';
  /** Lucide icon name at the start. */
  iconLeft?: string;
  invalid?: boolean;
  fullWidth?: boolean;
  style?: React.CSSProperties;
}
export function Select(props: SelectProps): JSX.Element;
