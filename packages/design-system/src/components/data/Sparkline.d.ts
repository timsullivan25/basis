import * as React from 'react';

/** Axis-less inline trend. Color derives from first-to-last direction unless overridden. */
export interface SparklineProps extends React.SVGAttributes<SVGSVGElement> {
  data?: number[];
  width?: number;
  height?: number;
  /** Override the auto up/down color — pass a --chart-* token for series identity. */
  color?: string;
  /** Faint gradient fill below the line. */
  area?: boolean;
  /** Dashed line at the first value, so gain/loss reads at a glance. */
  baseline?: boolean;
  strokeWidth?: number;
}
export function Sparkline(props: SparklineProps): JSX.Element;
