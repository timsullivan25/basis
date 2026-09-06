import * as React from 'react';

/** Click-or-drag file picker. Reports File objects; the caller owns the "selected file" state and preview. */
export interface FileDropzoneProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onDrop'> {
  /** Native input `accept`, e.g. ".xlsx" or "image/*". */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Helper text under the prompt, e.g. "XLSX files only". */
  hint?: React.ReactNode;
  onFilesSelected?: (files: File[]) => void;
  style?: React.CSSProperties;
}
export function FileDropzone(props: FileDropzoneProps): JSX.Element;
