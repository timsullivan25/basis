import type { ParsedSourceLine } from '../data';

/** "Group — Name" for display; the bare name when the row has no group. Matching never uses this — it runs on `name` alone. */
export function sourceLineLabel(line: Pick<ParsedSourceLine, 'group' | 'name'>): string {
  return line.group ? `${line.group} — ${line.name}` : line.name;
}
