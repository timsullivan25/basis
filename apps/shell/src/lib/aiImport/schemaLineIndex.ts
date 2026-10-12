import type { StatementSection } from '../../data';
import { normalize } from '../matchStatementLines';

export interface SchemaLineRef {
  lineName: string;
  sectionName: string;
}

/** Looks up a source label against the schema's line names and registered aliases (exact, normalized match — no fuzzy guessing). First definition wins when a name is shared. */
export interface SchemaLineIndex {
  match(label: string): SchemaLineRef | undefined;
}

export function buildSchemaLineIndex(sections: StatementSection[]): SchemaLineIndex {
  const byName = new Map<string, SchemaLineRef>();
  for (const section of sections) {
    for (const line of section.lines) {
      // Generated debt-schedule lines are never mapped to source data, so they shouldn't count as evidence either.
      if (line.debtScheduleRole) continue;
      const ref = { lineName: line.name, sectionName: section.name };
      for (const name of [line.name, ...line.aliases]) {
        const key = normalize(name);
        if (key && !byName.has(key)) byName.set(key, ref);
      }
    }
  }
  return { match: (label) => byName.get(normalize(label)) };
}
