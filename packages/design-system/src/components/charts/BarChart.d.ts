import * as React from 'react';

export interface BarDatum { label?: React.ReactNode; value: number; color?: string }

/** Categorical comparison. Horizontal for named categories (sectors, factors); vertical for periods. */
export interface BarChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data?: BarDatum[];
  height?: number;
  orientation?: 'vertical' | 'horizontal';
  /** Single-hue color when `signed` is false. */
  color?: string;
  /** Diverging around a zero rule, green/red by sign — use for contribution and attribution. */
  signed?: boolean;
  formatValue?: (v: number) => string;
  /** Horizontal only: trailing value column. */
  showValues?: boolean;
  /** Horizontal only: bar thickness in px. */
  barSize?: number;
  gap?: number;
}
export function BarChart(props: BarChartProps): JSX.Element;
