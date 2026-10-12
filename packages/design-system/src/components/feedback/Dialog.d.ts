import * as React from 'react';

/** Centered modal, 480px default, 8px radius, --shadow-4. Only for focused tasks and confirmations. */
export interface DialogProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Lucide icon name, rendered in brand blue. */
  icon?: string;
  /** Right-aligned action row; primary action last. */
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: number | string;
  children?: React.ReactNode;
}
export function Dialog(props: DialogProps): JSX.Element;
