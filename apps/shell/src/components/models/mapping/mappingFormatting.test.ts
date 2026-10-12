import { describe, expect, it } from 'vitest';
import type { LineMapping } from '../../../data';
import { isAmbiguous, needsReview } from './mappingFormatting';

const base: LineMapping = { targetLineId: 't', sourceLineIds: ['a'], alternativeSourceLineIds: ['b'], method: 'exact', confidence: 1, note: '', approved: false };
const target = { role: 'optional' } as Parameters<typeof needsReview>[0];

describe('isAmbiguous', () => {
  it('flags an automatic match that has alternatives, until it is approved or chosen manually', () => {
    expect(isAmbiguous(base)).toBe(true);
    expect(needsReview(target, base)).toBe(true);
    expect(isAmbiguous({ ...base, approved: true })).toBe(false);
    expect(isAmbiguous({ ...base, method: 'manual' })).toBe(false);
    expect(isAmbiguous({ ...base, alternativeSourceLineIds: undefined })).toBe(false);
  });
});
