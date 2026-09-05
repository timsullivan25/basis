import * as React from 'react';

export interface DonutDatum { label?: React.ReactNode; value: number; color?: string }

/** Composition ring, total in the middle. Six slices max — beyond that use a horizontal BarChart. */
export interface DonutChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data?: DonutDatum[];
  size?: number;
  thickness?: number;
  /** Centered figure. Defaults to the sum of values. */
  total?: number | string;
  /** Micro-caps line under the total. */
  label?: React.ReactNode;
  formatTotal?: (v: any) => string;
}
export function DonutChart(props: DonutChartProps): JSX.Element;
