import * as React from 'react';

/** 14px checkbox. Supports indeterminate for parent rows in grouped tables. */
export interface CheckboxProps extends Omit<React.HTMLAttributes<HTMLLabelElement>, 'onChange'> {
  checked?: boolean;
  /** Parent-of-partial-selection state; renders a dash. */
  indeterminate?: boolean;
  onChange?: (next: boolean) => void;
  label?: React.ReactNode;
  /** Secondary line under the label. */
  description?: React.ReactNode;
  disabled?: boolean;
}
export function Checkbox(props: CheckboxProps): JSX.Element;
