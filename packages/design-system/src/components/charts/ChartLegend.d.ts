import * as React from 'react';

export interface LegendSeries {
  key: string;
  label?: React.ReactNode;
  /** Use a --chart-* token so series identity is consistent across views. */
  color?: string;
  /** Renders a dashed rule instead of a swatch — for benchmarks. */
  dashed?: boolean;
  /** Current/latest figure, set in tabular mono. */
  value?: React.ReactNode;
}

/** Series key. Put it above the plot, not below — users read the key first. */
export interface ChartLegendProps extends React.HTMLAttributes<HTMLDivElement> {
  series?: LegendSeries[];
  /** Keys currently toggled off. */
  hidden?: string[];
  onToggle?: (key: string) => void;
  size?: 'sm' | 'md';
  direction?: 'row' | 'column';
}
export function ChartLegend(props: ChartLegendProps): JSX.Element;
