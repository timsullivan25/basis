/**
 * Layers a scenario's sparse driver-value overrides over the model's own driverValues, producing
 * one merged map suitable for evaluateModel's `driverValues` input — the engine itself never
 * learns about scenarios; callers just hand it the right map. A `null` (or an absent driverId/
 * index) in `scenarioDriverValues` means "not overridden here", falling back to the model's own
 * value at that cell (which may itself be explicit or null — evaluateModel's own computed-default
 * fallback takes over from there, unchanged). Calling this with an empty scenario override map is
 * the identity — `mergeScenarioDriverValues(modelDriverValues, {})` returns modelDriverValues'
 * values unchanged, which is what lets the implicit "Base case" flow through the exact same code
 * path as every named scenario in a batch-evaluation loop.
 */
export function mergeScenarioDriverValues(
  modelDriverValues: Record<string, (number | null)[]>,
  scenarioDriverValues: Record<string, (number | null)[]>,
): Record<string, (number | null)[]> {
  const driverIds = new Set([...Object.keys(modelDriverValues), ...Object.keys(scenarioDriverValues)]);
  const merged: Record<string, (number | null)[]> = {};
  for (const driverId of driverIds) {
    const modelValues = modelDriverValues[driverId] ?? [];
    const scenarioValues = scenarioDriverValues[driverId] ?? [];
    const length = Math.max(modelValues.length, scenarioValues.length);
    const values: (number | null)[] = [];
    for (let i = 0; i < length; i++) {
      values.push(scenarioValues[i] ?? modelValues[i] ?? null);
    }
    merged[driverId] = values;
  }
  return merged;
}
