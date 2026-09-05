import * as React from 'react';

export interface AccordionItem {
  key: string;
  label?: React.ReactNode;
  /** Right-aligned figures that stay visible while collapsed — the summary layer. */
  summary?: React.ReactNode;
  /** Lucide icon name. */
  icon?: string;
  content?: React.ReactNode;
}

/**
 * Progressive disclosure. The collapsed row must carry enough numbers to be useful
 * on its own; expanding adds depth, it does not reveal the point.
 *
 * @startingPoint section="Disclosure" subtitle="Summary rows that expand into detail" viewport="700x260"
 */
export interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  items?: AccordionItem[];
  /** Controlled: keys currently expanded. Allows multi-open. */
  openKeys?: string[];
  onToggle?: (key: string) => void;
  dense?: boolean;
}
export function Accordion(props: AccordionProps): JSX.Element;
