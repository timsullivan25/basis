import * as React from 'react';

/** Inline bar for limit utilization and weights. Turns red past `limit` and draws a marker there. */
export interface BarMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  /** Draws a dark limit marker; the fill turns red when value exceeds it. */
  limit?: number;
  color?: string;
  height?: number;
  width?: number | string;
  showValue?: boolean;
  formatValue?: (v: number) => string;
}
export function BarMeter(props: BarMeterProps): JSX.Element;
