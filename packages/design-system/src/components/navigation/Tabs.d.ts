import * as React from 'react';

export interface TabItem { value: string; label?: React.ReactNode; icon?: string; count?: number }

/** Underline tabs for switching layers inside a view (Summary / Positions / Attribution / Risk). */
export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  tabs?: TabItem[];
  value?: string;
  onChange?: (value: string) => void;
  size?: 'sm' | 'md';
  /** Right-aligned controls that live on the tab bar. */
  actions?: React.ReactNode;
}
export function Tabs(props: TabsProps): JSX.Element;
