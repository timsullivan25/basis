import * as React from 'react';

/**
 * Signed change, colored by direction and set in tabular mono.
 * Green up / red down; pass `invert` where down is good (tracking error, drawdown, fees).
 */
export interface DeltaValueProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Positive, negative or zero. Renders "—" for null/NaN. */
  value?: number | null;
  /** Appended unit. "bps" renders as " bps". */
  unit?: '%' | 'bps' | '$' | '' | string;
  decimals?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Directional glyph style. */
  glyph?: 'arrow' | 'triangle' | 'none';
  /** Tinted background chip — use sparingly, e.g. one hero delta per card. */
  chip?: boolean;
  signed?: boolean;
  /** Flip the color mapping when a decrease is the good outcome. */
  invert?: boolean;
}
export function DeltaValue(props: DeltaValueProps): JSX.Element;
