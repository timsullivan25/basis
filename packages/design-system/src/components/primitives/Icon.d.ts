import * as React from 'react';

/**
 * Small Lucide glyph, code-split per icon name via lucide-react's dynamic imports. Icons carry context at a
 * glance — 14px inside controls, 16px in nav, never larger than the text beside them.
 */
export interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Lucide icon name, kebab-case (e.g. "trending-up", "line-chart"). */
  name?: string;
  /** Pixel size. 12 = table cell, 14 = control, 16 = nav. */
  size?: number;
  /** CSS color. Defaults to currentColor. */
  color?: string;
  /** Lucide stroke width. 2 is standard; 1.5 for 20px+ glyphs. */
  strokeWidth?: number;
  /** Accessible label; falls back to name. */
  title?: string;
  style?: React.CSSProperties;
}
export function Icon(props: IconProps): JSX.Element;
