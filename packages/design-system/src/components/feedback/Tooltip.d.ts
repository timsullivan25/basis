import * as React from 'react';

/** Hover/focus explanation. One or two lines — anything longer belongs in a Popover. */
export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  content?: React.ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Open delay in ms. */
  delay?: number;
  maxWidth?: number;
  children?: React.ReactNode;
}
export function Tooltip(props: TooltipProps): JSX.Element;
