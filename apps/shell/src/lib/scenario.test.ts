import { describe, expect, it } from 'vitest';
import { mergeScenarioDriverValues, promoteScenarioDriverLine } from './scenario';

describe('mergeScenarioDriverValues', () => {
  it('returns the model values unchanged for an empty scenario override (Base case)', () => {
    const model = { growth: [0.1, 0.12, null] };
    expect(mergeScenarioDriverValues(model, {})).toEqual({ growth: [0.1, 0.12, null] });
  });

  it('a driver line present in the scenario is used verbatim, with no per-cell fallback to the model', () => {
    const model = { growth: [0.1, 0.12, 0.15] };
    const scenario = { growth: [0.5, 0.55, null] };
    expect(mergeScenarioDriverValues(model, scenario)).toEqual({ growth: [0.5, 0.55, null] });
  });

  it('a driver line absent from the scenario falls through entirely to the model', () => {
    const model = { growth: [0.1], margin: [0.3] };
    const scenario = { growth: [0.5] };
    expect(mergeScenarioDriverValues(model, scenario)).toEqual({ growth: [0.5], margin: [0.3] });
  });

  it('a driver the model never had (scenario-only) still resolves', () => {
    const model = {};
    const scenario = { growth: [0.2, null] };
    expect(mergeScenarioDriverValues(model, scenario)).toEqual({ growth: [0.2, null] });
  });

  it('a scenario line shorter than the model is NOT padded from the model past its own end', () => {
    const model = { growth: [0.1, 0.12, 0.15] };
    const scenario = { growth: [0.5] };
    expect(mergeScenarioDriverValues(model, scenario)).toEqual({ growth: [0.5] });
  });

  it('a driver line absent from both resolves to an empty model fallback', () => {
    const model = {};
    const scenario = {};
    expect(mergeScenarioDriverValues(model, scenario)).toEqual({});
  });
});

describe('promoteScenarioDriverLine', () => {
  it('copies the model\'s stored values into every period, then applies the edit', () => {
    const result = promoteScenarioDriverLine([0.1, 0.12, 0.15], 3, 1, 0.5);
    expect(result).toEqual([0.1, 0.5, 0.15]);
  });

  it('copies nulls through unchanged for periods the model itself has no explicit value at', () => {
    const result = promoteScenarioDriverLine([0.1, null, null], 3, 2, 0.2);
    expect(result).toEqual([0.1, null, 0.2]);
  });

  it('widens past targetLength when periodIndex is beyond it', () => {
    const result = promoteScenarioDriverLine([0.1, 0.12], 2, 4, 0.3);
    expect(result).toEqual([0.1, 0.12, null, null, 0.3]);
  });

  it('treats a shorter base array as null for the periods beyond its own end', () => {
    const result = promoteScenarioDriverLine([0.1], 4, 2, 0.2);
    expect(result).toEqual([0.1, null, 0.2, null]);
  });
});
