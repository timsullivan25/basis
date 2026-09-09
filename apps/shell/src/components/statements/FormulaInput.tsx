import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@basis/design-system';
import { getFormulaSegment } from './formulaUtils';
import { compileFormula, formatFormula, type NameIndex, type ResolvedFormula } from '../../lib/engine/resolve';

interface FormulaInputProps {
  value: ResolvedFormula | null;
  onChange: (formula: ResolvedFormula | null) => void;
  nameIndex: NameIndex;
  /** The line this formula belongs to — needed so a self-referencing pull-through (e.g. a
   *  line named "Net Income" reading a same-named line elsewhere) excludes itself when
   *  resolving, rather than being flagged as a self-cycle. */
  ownLineId: string;
}

/**
 * Edits a resolved formula as text. The stored value is always a resolved AST (see
 * lib/engine/resolve.ts) — this component keeps its own local text buffer for the actual typing
 * experience (autocomplete, live error display) and only compiles+commits on blur, so a
 * momentarily-invalid in-progress formula never has to round-trip through the parent's state.
 */
export function FormulaInput({ value, onChange, nameIndex, ownLineId }: FormulaInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => formatFormula(value, nameIndex));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Reset the display text when we're handed a different line's formula (not on every `value`
  // change — our own commit() already produces text that round-trips to the same display).
  useEffect(() => {
    setText(formatFormula(value, nameIndex));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownLineId]);

  const compileResult = useMemo(() => compileFormula(text, nameIndex, ownLineId), [text, nameIndex, ownLineId]);
  const errors = compileResult.ok ? [] : compileResult.errors;

  function refreshSuggestions(nextValue: string, cursorPos: number) {
    // Segment lookup still needs the full tokenizer vocabulary (a typed qualified form must
    // tokenize correctly even if it's not one of the suggestions offered below).
    const { word } = getFormulaSegment(nextValue, cursorPos, nameIndex.candidates());
    if (!word) {
      setSuggestions([]);
      return;
    }
    const lower = word.toLowerCase();
    // But only ever suggest strings that would actually resolve if picked — an ambiguous name's
    // bare form is deliberately excluded here (see NameIndex.suggestions).
    setSuggestions(
      nameIndex
        .suggestions(ownLineId)
        .filter((c) => c.toLowerCase() !== lower && c.toLowerCase().includes(lower))
        .slice(0, 8),
    );
  }

  function commitText(t: string) {
    const result = compileFormula(t, nameIndex, ownLineId);
    if (result.ok) onChange(result.formula);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setText(event.target.value);
    refreshSuggestions(event.target.value, event.target.selectionStart ?? event.target.value.length);
    setShowSuggestions(true);
  }

  function applySuggestion(name: string) {
    const input = inputRef.current;
    const cursorPos = input?.selectionStart ?? text.length;
    const { start, end } = getFormulaSegment(text, cursorPos, nameIndex.candidates());
    const next = text.slice(0, start) + name + text.slice(end);
    setText(next);
    setSuggestions([]);
    setShowSuggestions(false);
    commitText(next);
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
        value={text}
        placeholder="e.g. Revenue - COGS"
        invalid={errors.length > 0}
        onChange={handleChange}
        onFocus={(event) => refreshSuggestions(text, event.target.selectionStart ?? text.length)}
        onBlur={() => {
          commitText(text);
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
