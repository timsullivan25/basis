import * as React from 'react';

/**
 * Compact action button — 28px default, 24px in toolbars and table rows.
 * One primary per view; secondary is the workhorse; ghost for row-level actions.
 *
 * @startingPoint section="Primitives" subtitle="Buttons, icon buttons, badges and tags" viewport="700x180"
 */
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Lucide icon name shown before the label. */
  iconLeft?: string;
  /** Lucide icon name shown after the label (chevrons, external-link). */
  iconRight?: string;
  disabled?: boolean;
  /** Swaps the leading icon for a spinner and blocks clicks. */
  loading?: boolean;
  fullWidth?: boolean;
  /** Toggle state for filter/view buttons. */
  selected?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;
