import { tokenize } from '../../lib/engine/parse';

/**
 * The identifier segment surrounding `cursorPos` — bounded by operators, not whitespace,
 * since line names can contain spaces (e.g. "Net Income"). Built on the same known-names-aware
 * tokenizer the parser uses, so a name containing a hyphen or comma is one segment here too.
 */
export function getFormulaSegment(
  value: string,
  cursorPos: number,
  knownNames: string[],
): { start: number; end: number; word: string } {
  const tokens = tokenize(value, knownNames);
  const token = tokens.find((t) => t.start <= cursorPos && cursorPos <= t.end);
  if (token && (token.kind === 'name' || token.kind === 'func' || token.kind === 'unknown')) {
    return { start: token.start, end: token.end, word: token.text };
  }
  if (token && token.kind === 'num') {
    return { start: token.start, end: token.end, word: String(token.value) };
  }
  return { start: cursorPos, end: cursorPos, word: '' };
}
