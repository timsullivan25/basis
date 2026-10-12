import * as React from 'react';

export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectOptionGroup { label: string; options: SelectOption[] }

/** Dropdown for 4+ mutually exclusive options; below that use SegmentedControl. */
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'style'> {
  options?: SelectOption[];
  /** Rendered as native <optgroup> sections after `options` — for a long list (e.g. every line
   *  across every statement section) that benefits from a heading per group while scrolling.
   *  `options` still works standalone (e.g. a leading ungrouped placeholder) and combines with
   *  `groups` when both are given. */
  groups?: SelectOptionGroup[];
  size?: 'sm' | 'md' | 'lg';
  /** Lucide icon name at the start. */
  iconLeft?: string;
  invalid?: boolean;
  fullWidth?: boolean;
  style?: React.CSSProperties;
}
export function Select(props: SelectProps): JSX.Element;
