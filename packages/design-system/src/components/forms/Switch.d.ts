import * as React from 'react';

/** Toggle for settings that apply instantly. For form values that need saving, use Checkbox. */
export interface SwitchProps extends Omit<React.HTMLAttributes<HTMLLabelElement>, 'onChange'> {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  label?: React.ReactNode;
  size?: 'sm' | 'md';
  disabled?: boolean;
}
export function Switch(props: SwitchProps): JSX.Element;
