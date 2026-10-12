import { useState } from 'react';
import { Input } from '@basis/design-system';

function parsePercent(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n / 100;
}

/** Local buffer + selectOnFocus + Enter/blur-commit, same pattern DriverValueInput already uses
 *  — simplified (no wasEditCancelled) since this lives in a plain Card, not a DataTable cell that
 *  can be force-unmounted mid-edit. */
export function PercentInput({ value, onCommit }: { value: number | null; onCommit: (next: number | null) => void }) {
  const [text, setText] = useState(() => (value === null ? '' : String(value * 100)));
  return (
    <Input
      size="sm"
      mono
      type="number"
      selectOnFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(parsePercent(text));
      }}
      onBlur={() => onCommit(parsePercent(text))}
      style={{ width: 90 }}
    />
  );
}
