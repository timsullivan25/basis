import { describe, expect, it } from 'vitest';
import { dragBottomEdge, dragTopEdge, snapRange } from './sheetViewerMath';

// Non-empty rows only — 4, 7 and 8 are missing (blank in the sheet).
const rows = [1, 2, 3, 5, 6, 9, 10];

describe('snapRange', () => {
  it('snaps a range onto the rows that exist', () => {
    expect(snapRange(rows, { first: 4, last: 8 })).toEqual({ firstIdx: 3, lastIdx: 4 }); // rows 5-6
  });
  it('covers exact matches', () => {
    expect(snapRange(rows, { first: 2, last: 6 })).toEqual({ firstIdx: 1, lastIdx: 4 });
  });
  it('returns null when nothing falls inside the range', () => {
    expect(snapRange(rows, { first: 7, last: 8 })).toBeNull();
    expect(snapRange(rows, { first: 11, last: 20 })).toBeNull();
  });
});

describe('drag edges', () => {
  it('top edge rounds to the nearest row boundary and never passes the last row', () => {
    expect(dragTopEdge(2.4, 4)).toBe(2);
    expect(dragTopEdge(2.6, 4)).toBe(3);
    expect(dragTopEdge(-3, 4)).toBe(0);
    expect(dragTopEdge(9, 4)).toBe(4);
  });
  it('bottom edge rounds to the nearest boundary, never above the first row or below the last', () => {
    expect(dragBottomEdge(5.4, 1, 7)).toBe(4); // boundary 5 = bottom of row index 4
    expect(dragBottomEdge(0, 3, 7)).toBe(3);
    expect(dragBottomEdge(50, 3, 7)).toBe(6);
  });
});
