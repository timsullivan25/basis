import * as React from 'react';

export interface RadioOption { value: string; label: React.ReactNode; description?: React.ReactNode; disabled?: boolean }

/** Radio group. Use when options need explanatory sub-copy; otherwise SegmentedControl. */
export interface RadioProps extends React.HTMLAttributes<HTMLDivElement> {
  options?: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  direction?: 'column' | 'row';
  disabled?: boolean;
}
export function Radio(props: RadioProps): JSX.Element;
