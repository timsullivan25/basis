import { useState } from 'react';
import { Input } from '@basis/design-system';

/** A driver's stored value is always the raw number the engine reads (0.1 for a 10% growth
 *  rate) — these two convert to/from the units a person actually wants to type ("10" for 10%,
 *  a plain day count for "days"). Three units exist: '%', 'days', and 'raw' (a hardcoded number
 *  as-is — the Actual projection method, and manual historical-actuals entry), 'multiple-of'
 *  having been dropped as redundant with 'percent-of'. Shared by the workspace's Drivers card for
 *  both a schema line's own driver and a sub-line instance's (the latter reuses the exact same
 *  value bag and vocabulary — see LineInstance.projection's own doc comment). */
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
  if (unit === '%') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'raw') return value.toLocaleString();
  return `${value.toFixed(1)} days`;
}

/** Local text buffer + commit-on-blur, same pattern FormulaInput already uses — committing a
 *  driver value means an async IndexedDB write, so it shouldn't fire on every keystroke. Seeded
 *  from `initialValue` — the value actually shown in read mode (an explicit override, an
 *  inherited-from-Base value, or an engine-computed soft default) — not necessarily the raw stored
 *  override, so editing a pre-filled cell starts from what's visible instead of blank. Typing
 *  something new (or clearing it) still only ever writes an explicit override for this cell via
 *  onCommit; nothing is written just from seeding the buffer. */
export function DriverValueInput({
  initialValue, unit, onCommit, wasEditCancelled,
}: {
  initialValue: number | null;
  unit: string;
  onCommit: (value: number | null) => void;
  wasEditCancelled?: () => boolean;
}) {
  const [text, setText] = useState(() => toDisplayValue(initialValue, unit));
  return (
    <Input
      size="sm"
      mono
      type="number"
      autoFocus
      selectOnFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      // Enter (and Tab, which DataTable's own document-level handler additionally advances to the
      // next editable cell for) commit directly rather than relying on the blur DataTable's
      // deactivating-the-cell triggers — removing a still-focused node via a state change, with
      // nothing else taking real focus, doesn't reliably fire a synthetic blur in React (unlike a
      // genuine click-away, which shifts focus for real and blurs reliably), so the commit has to
      // happen here, not wait for one that may never come.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Tab') onCommit(fromDisplayValue(text, unit));
      }}
      onBlur={() => {
        if (wasEditCancelled?.()) return;
        onCommit(fromDisplayValue(text, unit));
      }}
    />
  );
}
