import * as React from 'react';

export interface SegmentOption { value: string; label?: React.ReactNode; icon?: string }

/**
 * Compact row of 2–5 exclusive options — period switchers, view modes, gross/net.
 * Preferred over Select when the option set is short and the labels are short.
 */
export interface SegmentedControlProps extends React.HTMLAttributes<HTMLDivElement> {
  options?: SegmentOption[];
  value?: string;
  onChange?: (value: string) => void;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}
export function SegmentedControl(props: SegmentedControlProps): JSX.Element;
