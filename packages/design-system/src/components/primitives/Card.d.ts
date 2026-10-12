import * as React from 'react';

/**
 * The module container. Every panel in the app is a Card: hairline border,
 * 5px radius, flat by default — elevation is reserved for overlays.
 *
 * @startingPoint section="Layout" subtitle="Panel container with header, actions and footer" viewport="700x260"
 */
export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Lucide icon name in the header. */
  icon?: string;
  /** Header-right controls — usually IconButton or small Button. */
  actions?: React.ReactNode;
  /** Muted footer strip: as-of stamps, source notes, row counts. */
  footer?: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** 0 = flat (default). 1–3 map to --shadow-1..3; use only for floating surfaces. */
  elevation?: 0 | 1 | 2 | 3;
  /** 34px header instead of 40px. */
  dense?: boolean;
  bodyStyle?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Card(props: CardProps): JSX.Element;
