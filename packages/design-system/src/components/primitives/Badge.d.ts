import * as React from 'react';

/** Status pill — system-owned state (Live, Stale, Breach, Draft). */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'info' | 'positive' | 'negative' | 'caution' | 'brand';
  size?: 'sm' | 'md';
  /** Lucide icon name shown before the label. */
  icon?: string;
  /** Leading 5px status dot. */
  dot?: boolean;
  /** Tinted background (default) vs solid fill. */
  subtle?: boolean;
  children?: React.ReactNode;
}
export function Badge(props: BadgeProps): JSX.Element;
