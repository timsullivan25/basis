import type { Model, ResolvedFormula, StatementLine, StatementSchema } from '../../data';
import { buildLineGraph } from './graph';

const TOLERANCE = 1e-6;
const MAX_ITERATIONS = 100;

export interface EvaluationResult {
  /** null means no value for that period — an uncalculated line with no mapped historical,
   *  or a calculated line where a required input is missing. */
  getValue(lineId: string, periodIndex: number): number | null;
  /** Set only for a cyclic group of lines whose fixed-point iteration didn't converge — a
   *  correctness bug to surface as an error, per the engine's staleness design, not a badge. */
  getError(lineId: string): string | undefined;
}

/** Non-finite (NaN/Infinity, e.g. from a division by zero elsewhere or 0^-1) collapses to null
 *  rather than leaking into the UI — a modeling engine should show a blank, not "NaN". */
function finite(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/**
 * Evaluates every calculated line of `model` against `schema`, for every period in the model's
 * timeline. Builds the line graph once (formulas don't reference periods, so the graph — and
 * its evaluation order — is identical across periods) and walks it once per period, memoizing
 * each (lineId, periodIndex) result. A group of mutually-dependent lines (a cycle) is solved
 * together per period via Gauss-Seidel fixed-point iteration instead of a single pass.
 */
export function evaluateModel(schema: StatementSchema, model: Model): EvaluationResult {
  const graph = buildLineGraph(schema);
  const linesById = new Map<string, StatementLine>(schema.sections.flatMap((s) => s.lines).map((l) => [l.id, l]));
  const periodCount = model.timeline.length;

  const memo = new Map<string, Map<number, number | null>>();
  for (const id of graph.lineIds) memo.set(id, new Map());
  const errors = new Map<string, string>();

  function historicalValue(lineId: string, periodIndex: number): number | null {
    return model.historicals[lineId]?.[periodIndex] ?? null;
  }

  function readLine(lineId: string, periodIndex: number, cycleValues: Map<string, number | null> | undefined): number | null {
    if (cycleValues?.has(lineId)) return cycleValues.get(lineId)!;
    const cell = memo.get(lineId);
    if (cell?.has(periodIndex)) return cell.get(periodIndex)!;
    // A ref outside the graph (shouldn't happen — every schema line is in graph.lineIds) or a
    // period not yet computed in this pass. Either way, null is the safe fallback, not a throw.
    return null;
  }

  function evalNode(
    node: ResolvedFormula,
    periodIndex: number,
    cycleValues: Map<string, number | null> | undefined,
  ): number | null {
    if (node.kind === 'num') return node.value;
    if (node.kind === 'ref') return readLine(node.lineId, periodIndex, cycleValues);
    if (node.kind === 'neg') {
      const v = evalNode(node.arg, periodIndex, cycleValues);
      return v === null ? null : -v;
    }
    if (node.kind === 'bin') {
      const l = evalNode(node.left, periodIndex, cycleValues);
      const r = evalNode(node.right, periodIndex, cycleValues);
      if (l === null || r === null) return null;
      switch (node.op) {
        case '+':
          return finite(l + r);
        case '-':
          return finite(l - r);
        case '*':
          return finite(l * r);
        case '/':
          return r === 0 ? null : finite(l / r);
        case '^':
          return finite(Math.pow(l, r));
      }
    }
    // call — abs takes exactly one arg and propagates null; sum/min/max/avg skip null args
    // (an Excel-like "ignore blanks"), and are null only when every arg is null.
    const args = node.args.map((a) => evalNode(a, periodIndex, cycleValues));
    if (node.fn === 'abs') return args[0] === null ? null : finite(Math.abs(args[0]));
    const present = args.filter((v): v is number => v !== null);
    if (present.length === 0) return null;
    switch (node.fn) {
      case 'sum':
        return finite(present.reduce((a, b) => a + b, 0));
      case 'min':
        return finite(Math.min(...present));
      case 'max':
        return finite(Math.max(...present));
      case 'avg':
        return finite(present.reduce((a, b) => a + b, 0) / present.length);
    }
  }

  function computeLine(lineId: string, periodIndex: number, cycleValues: Map<string, number | null> | undefined): number | null {
    const line = linesById.get(lineId);
    if (!line?.formula) return historicalValue(lineId, periodIndex);
    return evalNode(line.formula, periodIndex, cycleValues);
  }

  for (let p = 0; p < periodCount; p++) {
    for (const group of graph.order) {
      // A size-1 group is only non-cyclic if the line doesn't reference itself — self-exclusion
      // in resolve.ts means authoring never produces this, but a hand-edited/imported schema
      // could, so it's treated the same as any other cycle rather than assumed impossible.
      const isCycle = group.length > 1 || (graph.precedents.get(group[0]) ?? []).includes(group[0]);

      if (!isCycle) {
        const [id] = group;
        memo.get(id)!.set(p, computeLine(id, p, undefined));
        continue;
      }

      const cycleValues = new Map<string, number | null>();
      for (const id of group) cycleValues.set(id, historicalValue(id, p) ?? 0);

      let converged = false;
      for (let iter = 0; iter < MAX_ITERATIONS && !converged; iter++) {
        converged = true;
        for (const id of group) {
          const prev = cycleValues.get(id)!;
          const next = computeLine(id, p, cycleValues);
          const moved = next === null || prev === null ? next !== prev : Math.abs(next - prev) > TOLERANCE;
          if (moved) converged = false;
          cycleValues.set(id, next);
        }
      }
      if (!converged) {
        for (const id of group) {
          errors.set(id, `Circular formula didn't converge after ${MAX_ITERATIONS} iterations`);
        }
      }
      for (const id of group) memo.get(id)!.set(p, cycleValues.get(id) ?? null);
    }
  }

  return {
    getValue: (lineId, periodIndex) => memo.get(lineId)?.get(periodIndex) ?? null,
    getError: (lineId) => errors.get(lineId),
  };
}
