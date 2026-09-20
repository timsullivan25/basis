import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(() => formatFormula(value, nameIndex));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Which suggestion Enter/Tab would apply — always starts on the first one.
  const [highlighted, setHighlighted] = useState(0);
  const [focused, setFocused] = useState(false);
  const [, setLayoutTick] = useState(0);

  // Reset the display text when we're handed a different line's formula (not on every `value`
  // change — our own commit() already produces text that round-trips to the same display).
  useEffect(() => {
    setText(formatFormula(value, nameIndex));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownLineId]);

  // Grows with its content instead of scrolling sideways — a long formula stays fully visible.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const compileResult = useMemo(() => compileFormula(text, nameIndex, ownLineId), [text, nameIndex, ownLineId]);
  const errors = compileResult.ok ? [] : compileResult.errors;

  // The suggestion list is portaled to <body> and positioned against the input's own rect: the
  // line-settings panel (and any scrolling table cell) clips overflow, which cut an inline
  // absolutely-positioned list off. Re-measured on any scroll/resize so it follows the input
  // (the input itself growing a line can scroll the panel — that must not dismiss the list).
  useEffect(() => {
    if (!showSuggestions) return;
    const reposition = () => setLayoutTick((n) => n + 1);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [showSuggestions]);

  const LIST_MAX_HEIGHT = 200;
  function listPosition(): CSSProperties {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return { display: 'none' };
    // Flip above the input when there isn't room below.
    const below = rect.bottom + 4 + LIST_MAX_HEIGHT <= window.innerHeight;
    return below
      ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
      : { bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width };
  }

  function refreshSuggestions(nextValue: string, cursorPos: number) {
    // Segment lookup still needs the full tokenizer vocabulary (a typed qualified form must
    // tokenize correctly even if it's not one of the suggestions offered below).
    const { word } = getFormulaSegment(nextValue, cursorPos, nameIndex.candidates());
    setHighlighted(0);
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

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
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
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* The design system has no multi-line field, so this mirrors Input (size sm, mono) around a
          textarea: same border/focus treatment, but the box grows with wrapped text. */}
      <div
        style={{
          display: 'flex', width: '100%', boxSizing: 'border-box', minWidth: 0,
          padding: '4px var(--space-4)', minHeight: 'var(--control-sm)',
          background: 'var(--field-bg)', borderRadius: 'var(--radius-md)',
          border: `1px solid ${errors.length > 0 ? 'var(--red-600)' : focused ? 'var(--border-focus)' : 'var(--field-border)'}`,
          boxShadow: focused ? (errors.length > 0 ? 'var(--focus-ring-danger)' : 'var(--focus-ring)') : 'var(--shadow-inset-field)',
          transition: 'var(--transition-control)',
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder="e.g. Revenue - COGS"
          spellCheck={false}
          onChange={handleChange}
          onFocus={(event) => {
            setFocused(true);
            refreshSuggestions(text, event.target.selectionStart ?? text.length);
          }}
          onBlur={() => {
            setFocused(false);
            commitText(text);
            // Delay so a click on a suggestion registers before the list unmounts.
            setTimeout(() => setShowSuggestions(false), 150);
          }}
          onKeyDown={(event) => {
            const listOpen = showSuggestions && suggestions.length > 0;
            if (event.key === 'Escape') {
              setShowSuggestions(false);
            } else if (listOpen && event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlighted((i) => (i + 1) % suggestions.length);
            } else if (listOpen && event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlighted((i) => (i - 1 + suggestions.length) % suggestions.length);
            } else if (listOpen && (event.key === 'Enter' || event.key === 'Tab')) {
              event.preventDefault();
              applySuggestion(suggestions[Math.min(highlighted, suggestions.length - 1)]);
            } else if (event.key === 'Enter') {
              // A formula is one logical line — wrapping is visual only, never a typed newline.
              event.preventDefault();
            }
          }}
          style={{
            flex: '1 1 auto', minWidth: 0, width: '100%', padding: 0, margin: 0, border: 'none', outline: 'none',
            background: 'transparent', resize: 'none', overflow: 'hidden', display: 'block',
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
            lineHeight: 1.5, color: 'var(--text-primary)', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
          }}
        />
      </div>
      {showSuggestions && suggestions.length > 0 ? createPortal(
        <div
          style={{
            position: 'fixed', ...listPosition(), zIndex: 1000,
            background: 'var(--surface-card)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-3)', overflow: 'hidden',
            maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto',
          }}
        >
          {suggestions.map((name, index) => (
            <button
              key={name}
              type="button"
              ref={index === highlighted ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => applySuggestion(name)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: 'var(--space-3) var(--space-5)',
                background: index === highlighted ? 'var(--surface-hover)' : 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color: 'var(--text-body)',
              }}
            >
              {name}
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
      {errors.length > 0 ? (
        <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-2xs)', color: 'var(--text-negative)' }}>
          {errors[0]}
        </div>
      ) : null}
    </div>
  );
}
