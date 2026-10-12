import * as React from 'react';

export interface BreadcrumbItem { value?: string; label?: React.ReactNode; icon?: string }

/** Drill-path trail — mandatory on any view reached by drilling more than one level. */
export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items?: BreadcrumbItem[];
  onNavigate?: (value: string | undefined, index: number) => void;
}
export function Breadcrumb(props: BreadcrumbProps): JSX.Element;
