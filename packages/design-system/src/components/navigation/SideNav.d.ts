import * as React from 'react';

export interface SideNavItem {
  value?: string;
  label?: React.ReactNode;
  /** Lucide icon name, 15px. */
  icon?: string;
  /** Right-aligned count in mono micro-type. */
  badge?: React.ReactNode;
  /** Sub-items, revealed when the parent is active. */
  children?: { value: string; label: React.ReactNode }[];
  /** Renders a micro-caps section heading instead of a nav item. */
  section?: string;
}

/**
 * 216px left rail (48px collapsed). One entry per module — the modular top level of the app.
 *
 * @startingPoint section="Navigation" subtitle="Module rail with sections and nested workspaces" viewport="700x300"
 */
export interface SideNavProps extends React.HTMLAttributes<HTMLElement> {
  items?: SideNavItem[];
  value?: string;
  onChange?: (value: string) => void;
  /** Brand lockup slot. */
  header?: React.ReactNode;
  /** User / environment slot. */
  footer?: React.ReactNode;
  collapsed?: boolean;
}
export function SideNav(props: SideNavProps): JSX.Element;
