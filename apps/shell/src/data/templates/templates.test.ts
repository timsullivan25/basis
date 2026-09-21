import { describe, expect, it } from 'vitest';
import { createBundledTemplates } from './index';
import { DEFAULT_SCHEMA_ID } from '../defaultStatementSchema';

describe('bundled templates', () => {
  it('have unique ids distinct from the built-in default, and a role on every line', () => {
    const templates = createBundledTemplates();
    const ids = [DEFAULT_SCHEMA_ID, ...templates.map((t) => t.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of templates) {
      for (const line of t.sections.flatMap((s) => s.lines)) expect(line.role).toBeTruthy();
    }
  });
});
