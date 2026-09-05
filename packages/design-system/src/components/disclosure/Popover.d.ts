import * as React from 'react';

/** Click-anchored panel: column pickers, methodology notes, filter mini-forms. Closes on outside click. */
export interface PopoverProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The clickable anchor — usually a Button or IconButton. */
  trigger?: React.ReactNode;
  /** Controlled open state; omit for self-managed. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start';
  width?: number;
  /** Micro-caps header strip. */
  title?: React.ReactNode;
  children?: React.ReactNode;
}
export function Popover(props: PopoverProps): JSX.Element;
