/**
 * Layers a scenario's driver-value overrides over the model's own driverValues, producing one
 * merged map suitable for evaluateModel's `driverValues` input — the engine itself never learns
 * about scenarios; callers just hand it the right map. Overriding is per-line, all-or-nothing: a
 * driverId entirely absent from `scenarioDriverValues` means "this line tracks the model's own
 * values live" (used verbatim, cell for cell); a driverId present in `scenarioDriverValues` means
 * this scenario's array is used verbatim for every period of that line, with no per-cell fallback
 * to the model — a `null` within an explicit line stays null here (evaluateModel's own computed-
 * default fallback takes over from there, unchanged, since that fallback is a pure function of
 * schema + historicals and isn't case-specific). Calling this with an empty scenario override map
 * is the identity — `mergeScenarioDriverValues(modelDriverValues, {})` returns modelDriverValues'
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
    merged[driverId] = driverId in scenarioDriverValues ? scenarioDriverValues[driverId] : (modelDriverValues[driverId] ?? []);
  }
  return merged;
}

/**
 * Promotes a scenario's driver line from inherited to explicit: called on the first edit to any
 * period of a line that has no entry yet in the scenario's driverValues. Builds a full-length
 * array by copying the model's (Base's) currently stored values verbatim — including any `null`s,
 * which is fine, since evaluateModel's computed-default fallback for a `null` cell doesn't depend
 * on which case is being evaluated (see mergeScenarioDriverValues's doc comment) — then overwrites
 * `periodIndex` with the actual edit. `targetLength` is the model's full timeline length (the
 * existing array-length convention enforced elsewhere, e.g. ModelWorkspaceScreen's confirmShrink),
 * widened to cover `periodIndex` if it's somehow past the end.
 */
export function promoteScenarioDriverLine(
  baseValues: (number | null)[],
  targetLength: number,
  periodIndex: number,
  value: number | null,
): (number | null)[] {
  const length = Math.max(targetLength, periodIndex + 1);
  const values: (number | null)[] = [];
  for (let i = 0; i < length; i++) values.push(baseValues[i] ?? null);
  values[periodIndex] = value;
  return values;
}
