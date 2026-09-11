import { useState } from 'react';
import { Input } from '@basis/design-system';

/** A driver's stored value is always the raw number the engine reads (0.1 for a 10% growth
 *  rate) — these two convert to/from the units a person actually wants to type ("10" for 10%,
 *  a plain day count for "days"). Only two units exist ('%' and 'days'), 'multiple-of' having
 *  been dropped as redundant with 'percent-of'. Shared by the workspace's main Drivers card and
 *  InstancesPanel (a sub-line's driver reuses the exact same value bag and vocabulary). */
export function toDisplayValue(stored: number | null, unit: string): string {
  if (stored === null) return '';
  return unit === '%' ? String(stored * 100) : String(stored);
}
export function fromDisplayValue(display: string, unit: string): number | null {
  const trimmed = display.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (Number.isNaN(n)) return null;
  return unit === '%' ? n / 100 : n;
}
export function formatDriverValue(value: number | null, unit: string): string {
  if (value === null) return '—';
  return unit === '%' ? `${(value * 100).toFixed(1)}%` : `${value.toFixed(1)} days`;
}

/** Local text buffer + commit-on-blur, same pattern FormulaInput already uses — committing a
 *  driver value means an async IndexedDB write, so it shouldn't fire on every keystroke. Always
 *  seeded from the raw stored value (blank if unset), never the computed default — editing means
 *  setting an override, not accepting-then-resaving whatever was being assumed. */
export function DriverValueInput({
  stored, unit, onCommit, wasEditCancelled,
}: {
  stored: number | null;
  unit: string;
  onCommit: (value: number | null) => void;
  wasEditCancelled?: () => boolean;
}) {
  const [text, setText] = useState(() => toDisplayValue(stored, unit));
  return (
    <Input
      size="sm"
      mono
      type="number"
      autoFocus
      selectOnFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      // Enter commits directly rather than relying on the blur DataTable's document-level Enter
      // handler triggers by deactivating the cell — removing a still-focused node via a state
      // change, with nothing else taking real focus, doesn't reliably fire a synthetic blur in
      // React (unlike a genuine click-away, which shifts focus for real and blurs reliably), so
      // the commit has to happen here, not wait for one that may never come.
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(fromDisplayValue(text, unit));
      }}
      onBlur={() => {
        if (wasEditCancelled?.()) return;
        onCommit(fromDisplayValue(text, unit));
      }}
    />
  );
}
