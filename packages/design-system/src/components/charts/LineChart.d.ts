import * as React from 'react';

export interface LineSeries {
  key: string;
  data?: number[];
  /** --chart-* token. --chart-benchmark + dashed for the benchmark line. */
  color?: string;
  dashed?: boolean;
}

/**
 * Time-series plot. Width auto-fits the container; horizontal gridlines only,
 * mono axis figures, dashed crosshair on hover.
 *
 * @startingPoint section="Charts" subtitle="Time series with benchmark and crosshair" viewport="700x240"
 */
export interface LineChartProps extends React.HTMLAttributes<HTMLDivElement> {
  series?: LineSeries[];
  /** X labels; every nth is drawn to avoid collisions. */
  labels?: string[];
  height?: number;
  /** Fixed width. Omit to fill the container. */
  width?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  yTicks?: number;
  /** Draws a solid rule at 0 and includes 0 in the domain — use for P&L. */
  zeroLine?: boolean;
  formatY?: (v: number) => string;
  /** Faint fill under each line. Only legible with one or two series. */
  area?: boolean;
  /** Series keys toggled off by ChartLegend. */
  hidden?: string[];
}
export function LineChart(props: LineChartProps): JSX.Element;
