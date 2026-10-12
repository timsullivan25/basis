import * as React from 'react';

/** Icon-only square control. Always pass `label` — it is the accessible name and the tooltip. */
export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  /** Lucide icon name. */
  icon?: string;
  /** Accessible name + native tooltip. Required in practice. */
  label?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'outline';
  disabled?: boolean;
  selected?: boolean;
  style?: React.CSSProperties;
}
export function IconButton(props: IconButtonProps): JSX.Element;
