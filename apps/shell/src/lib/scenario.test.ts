import { describe, expect, it } from 'vitest';
import { mergeScenarioDriverValues } from './scenario';

describe('mergeScenarioDriverValues', () => {
  it('returns the model values unchanged for an empty scenario override (Base case)', () => {
    const model = { growth: [0.1, 0.12, null] };
    expect(mergeScenarioDriverValues(model, {})).toEqual({ growth: [0.1, 0.12, null] });
  });

  it('a scenario explicit value wins over the model value at the same cell', () => {
    const model = { growth: [0.1, 0.12, 0.15] };
    const scenario = { growth: [null, 0.2, null] };
    expect(mergeScenarioDriverValues(model, scenario)).toEqual({ growth: [0.1, 0.2, 0.15] });
  });

  it('a driver the scenario never mentions falls through entirely to the model', () => {
    const model = { growth: [0.1], margin: [0.3] };
    const scenario = { growth: [0.5] };
    expect(mergeScenarioDriverValues(model, scenario)).toEqual({ growth: [0.5], margin: [0.3] });
  });

  it('a driver the model never had (scenario-only) still resolves, model side falling to null', () => {
    const model = {};
    const scenario = { growth: [0.2, null] };
    expect(mergeScenarioDriverValues(model, scenario)).toEqual({ growth: [0.2, null] });
  });

  it('a scenario array shorter than the model falls back to the model past its own end', () => {
    const model = { growth: [0.1, 0.12, 0.15] };
    const scenario = { growth: [0.5] };
    expect(mergeScenarioDriverValues(model, scenario)).toEqual({ growth: [0.5, 0.12, 0.15] });
  });

  it('both sides null at a cell resolves to null (evaluateModel applies its own computed default from there)', () => {
    const model = { growth: [null] };
    const scenario = { growth: [null] };
    expect(mergeScenarioDriverValues(model, scenario)).toEqual({ growth: [null] });
  });
});
