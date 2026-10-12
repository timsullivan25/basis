import * as React from 'react';

/** Transient confirmation, bottom-right, 320px, dark surface. Stack at most three. */
export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'info' | 'positive' | 'negative' | 'caution';
  title?: React.ReactNode;
  /** Undo / view-detail control. */
  action?: React.ReactNode;
  onDismiss?: () => void;
  children?: React.ReactNode;
}
export function Toast(props: ToastProps): JSX.Element;
