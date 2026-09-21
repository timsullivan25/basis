import type { CSSProperties, ReactNode } from 'react';
import { tokenize } from '../../lib/engine/parse';
import type { NameIndex } from '../../lib/engine/resolve';

/** Text metrics shared by the highlight layer and the textarea sitting exactly over it — they must
 *  wrap identically, so both take this one object. */
export const FORMULA_TEXT_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  fontVariantNumeric: 'var(--numeric-tabular)',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

const styles = {
  // The line name is the point; everything around it recedes.
  name: { color: 'var(--text-primary)' },
  qualifier: { color: 'var(--text-tertiary)' },
  func: { color: 'var(--text-brand)', fontWeight: 'var(--weight-semibold)' },
  operator: { color: 'var(--text-secondary)' },
  number: { color: 'var(--text-primary)' },
} satisfies Record<string, CSSProperties>;

/** A formula's text, colored by token: the "Section." qualifier of a qualified reference muted
 *  next to its line name, function names distinct, operators and parentheses quieter. Purely
 *  visual — it renders the same characters in the same places as `text`, so it can sit under a
 *  transparent textarea. Text the tokenizer doesn't cover (whitespace, mostly) passes through. */
export function FormulaHighlight({ text, nameIndex }: { text: string; nameIndex: NameIndex }) {
  const tokens = tokenize(text, nameIndex.candidates());
  const parts: ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((token, i) => {
    if (token.start > cursor) parts.push(text.slice(cursor, token.start));
    const raw = text.slice(token.start, token.end);
    if (token.kind === 'name') {
      const q = nameIndex.qualifierLength(raw);
      parts.push(
        q > 0 ? (
          <span key={i}>
            <span style={styles.qualifier}>{raw.slice(0, q)}</span>
            <span style={styles.name}>{raw.slice(q)}</span>
          </span>
        ) : (
          <span key={i} style={styles.name}>{raw}</span>
        ),
      );
    } else if (token.kind === 'func') {
      parts.push(<span key={i} style={styles.func}>{raw}</span>);
    } else if (token.kind === 'op') {
      parts.push(<span key={i} style={styles.operator}>{raw}</span>);
    } else if (token.kind === 'num') {
      parts.push(<span key={i} style={styles.number}>{raw}</span>);
    } else {
      parts.push(<span key={i} style={styles.name}>{raw}</span>);
    }
    cursor = token.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  // A trailing zero-width space keeps the layer one line tall when the text is empty or ends in a
  // space, so its height (which sizes the field) always matches the textarea's.
  return <>{parts}{'\u200b'}</>;
}
