import { describe, expect, it } from 'vitest';
import { parseBasisTemplate } from '../parseBasisTemplate';
import { writeBasisTemplate } from './writeBasisTemplate';

describe('writeBasisTemplate', () => {
  it('round-trips through the parser, keeping each line\'s group apart from its name', async () => {
    const blob = await writeBasisTemplate({
      periods: [{ type: 'FY', date: '2024-12-31T00:00:00.000Z', name: 'FY 2024' }],
      lines: [
        { id: 'a', section: 'Segments', group: 'Academia', name: 'Revenue', values: [60] },
        { id: 'b', section: 'Segments', name: 'Total', values: [100] },
      ],
    });
    const parsed = await parseBasisTemplate(blob);
    expect(parsed.lines.map((l) => [l.section, l.group, l.name, l.values[0]])).toEqual([
      ['Segments', 'Academia', 'Revenue', 60],
      ['Segments', undefined, 'Total', 100],
    ]);
    expect(parsed.periods.map((p) => p.name)).toEqual(['FY 2024']);
  });
});
