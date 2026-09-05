import * as React from 'react';

/** Inline, persistent message about the current view — data staleness, limit breaches, model notes. */
export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'info' | 'positive' | 'caution' | 'negative' | 'neutral';
  title?: React.ReactNode;
  /** Lucide icon name; each tone has a sensible default. */
  icon?: string;
  /** Trailing controls, usually a link-variant Button. */
  actions?: React.ReactNode;
  onDismiss?: () => void;
  /** Single-line layout for banners above a table. */
  compact?: boolean;
  children?: React.ReactNode;
}
export function Alert(props: AlertProps): JSX.Element;
