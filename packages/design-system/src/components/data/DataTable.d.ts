import * as React from 'react';

export interface DataTableColumn {
  key: string;
  label?: React.ReactNode;
  /** Right-aligns and switches the cell to tabular mono. Use for every figure. */
  numeric?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  maxWidth?: number | string;
  /** Medium weight — for the identity column. */
  emphasis?: boolean;
  /** Secondary text color. */
  muted?: boolean;
  sortable?: boolean;
  /** Tooltip on the header + info glyph; explain the methodology here. */
  description?: string;
  render?: (value: any, row: any) => React.ReactNode;
}

/**
 * The workhorse. 30px rows (26px dense), sticky micro-caps header, sortable columns,
 * group separator rows (`{ __group: 'Label', id }`) and an inline expanded detail row.
 *
 * @startingPoint section="Data" subtitle="Dense sortable table with drill-down rows" viewport="700x300"
 */
export interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: DataTableColumn[];
  rows?: any[];
  /** Field used as the React key and selection id. */
  rowKey?: string;
  /** 26px rows and 12px type. */
  dense?: boolean;
  striped?: boolean;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (sort: { key: string; dir: 'asc' | 'desc' }) => void;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (keys: string[]) => void;
  /** rowKey of the row whose detail panel is open. */
  expandedKey?: string | null;
  onRowClick?: (row: any) => void;
  /** Renders the inline detail panel for the expanded row. */
  renderDetail?: (row: any) => React.ReactNode;
  stickyHeader?: boolean;
  maxHeight?: number | string;
}
export function DataTable(props: DataTableProps): JSX.Element;
