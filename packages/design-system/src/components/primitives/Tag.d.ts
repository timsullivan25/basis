import * as React from 'react';

/** Pill for user-applied labels and active filters. Pair with onRemove in filter bars. */
export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Lucide icon name. */
  icon?: string;
  /** Renders a trailing dismiss affordance. */
  onRemove?: (e: React.MouseEvent) => void;
  /** 6px leading dot — use a --chart-* token to bind the tag to a series. */
  color?: string;
  /** Adds hover feedback when the whole tag is clickable. */
  interactive?: boolean;
  children?: React.ReactNode;
}
export function Tag(props: TagProps): JSX.Element;
