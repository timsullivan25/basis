import * as React from 'react';

/** Label/hint/error scaffold. Wrap any input; labels are uppercase 11px micro-caps. */
export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  /** Shown as an info glyph tooltip beside the label, or as helper text when unlabelled. */
  hint?: string;
  /** Replaces the hint and turns the message red. */
  error?: string;
  required?: boolean;
  htmlFor?: string;
  /** Label to the left in a 120px column — use in settings and filter drawers. */
  inline?: boolean;
  children?: React.ReactNode;
}
export function Field(props: FieldProps): JSX.Element;
