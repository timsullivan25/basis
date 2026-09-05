import * as React from 'react';

/**
 * Layer-1 KPI tile — the summary layer users land on. Give it `onDrill` and it
 * becomes the entry point to the detail view; the affordance appears on hover.
 *
 * @startingPoint section="Data" subtitle="KPI tiles with delta, sparkline and drill-in" viewport="700x150"
 */
export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Micro-caps label, e.g. "Net exposure". */
  label?: React.ReactNode;
  /** Preformatted primary figure — format upstream, the card does not round. */
  value?: React.ReactNode;
  /** Small unit trailing the value ("% NAV", "mm"). */
  unit?: React.ReactNode;
  delta?: number | null;
  deltaUnit?: string;
  /** Context for the delta, e.g. "vs prior close". */
  deltaLabel?: React.ReactNode;
  /** Series for the inline sparkline. */
  spark?: number[];
  sparkColor?: string;
  /** Lucide icon name beside the label. */
  icon?: string;
  /** Right-aligned provenance note, e.g. "T+1". */
  footnote?: React.ReactNode;
  /** Makes the whole tile a drill-in target. */
  onDrill?: () => void;
  drillLabel?: string;
  /** Flip delta colors where a decrease is good. */
  invertDelta?: boolean;
  /** 2px top accent for status emphasis. Use at most one per row. */
  tone?: 'default' | 'brand' | 'positive' | 'negative' | 'caution';
}
export function MetricCard(props: MetricCardProps): JSX.Element;
