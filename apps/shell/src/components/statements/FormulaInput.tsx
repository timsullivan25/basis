import { useMemo, useRef, useState } from 'react';
import { Input } from '@basis/design-system';
import { getFormulaSegment, validateFormula } from './formulaUtils';

interface FormulaInputProps {
  value: string;
  onChange: (value: string) => void;
  knownNames: string[];
}

export function FormulaInput({ value, onChange, knownNames }: FormulaInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const errors = useMemo(() => validateFormula(value, knownNames), [value, knownNames]);

  function refreshSuggestions(nextValue: string, cursorPos: number) {
    const { word } = getFormulaSegment(nextValue, cursorPos, knownNames);
    if (!word) {
      setSuggestions([]);
      return;
    }
    const lower = word.toLowerCase();
    setSuggestions(
      knownNames.filter((name) => name.toLowerCase() !== lower && name.toLowerCase().includes(lower)).slice(0, 8),
    );
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
    refreshSuggestions(event.target.value, event.target.selectionStart ?? event.target.value.length);
    setShowSuggestions(true);
  }

  function applySuggestion(name: string) {
    const input = inputRef.current;
    const cursorPos = input?.selectionStart ?? value.length;
    const { start, end } = getFormulaSegment(value, cursorPos, knownNames);
    const next = value.slice(0, start) + name + value.slice(end);
    onChange(next);
    setSuggestions([]);
    setShowSuggestions(false);
    requestAnimationFrame(() => {
      const pos = start + name.length;
      input?.focus();
      input?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div style={{ position: 'relative' }}>
      <Input
        ref={inputRef}
        size="sm"
        mono
        value={value}
        placeholder="e.g. Revenue - COGS"
        invalid={errors.length > 0}
        onChange={handleChange}
        onFocus={(event) => refreshSuggestions(value, event.target.selectionStart ?? value.length)}
        onBlur={() => {
          // Delay so a click on a suggestion registers before the list unmounts.
          setTimeout(() => setShowSuggestions(false), 150);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setShowSuggestions(false);
        }}
      />
      {showSuggestions && suggestions.length > 0 ? (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 'var(--space-2)', zIndex: 10,
            background: 'var(--surface-card)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-3)', overflow: 'hidden',
            maxHeight: 200, overflowY: 'auto',
          }}
        >
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySuggestion(name)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: 'var(--space-3) var(--space-5)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color: 'var(--text-body)',
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {errors.length > 0 ? (
        <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-2xs)', color: 'var(--text-negative)' }}>
          {errors[0]}
        </div>
      ) : null}
    </div>
  );
}
