import type { StatementSchema } from '../../data';
import { collectRefIds } from './resolve';

export interface LineGraph {
  /** Every line id in the schema, calculated or not. */
  lineIds: string[];
  /** lineId -> ids its formula directly reads. Empty for a non-calculated line. */
  precedents: Map<string, string[]>;
  /** lineId -> ids that directly read it. */
  dependents: Map<string, string[]>;
  /**
   * Evaluation order, precedents before dependents. Each entry is normally one line; an entry
   * with more than one id (or a line naming itself) is a mutual/self dependency that can't be
   * evaluated line-by-line and must be solved together via fixed-point iteration instead.
   */
  order: string[][];
}

/** Builds the line-level dependency graph and its evaluation order via Tarjan's SCC algorithm.
 *  Formulas never reference a period, only other lines, so this graph is shared across every
 *  period in a model — evaluate.ts walks it once per period, not once per (line, period). */
export function buildLineGraph(schema: StatementSchema): LineGraph {
  const lines = schema.sections.flatMap((s) => s.lines);
  const lineIds = lines.map((l) => l.id);
  const idSet = new Set(lineIds);

  const precedents = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const id of lineIds) dependents.set(id, []);

  for (const line of lines) {
    // A dangling ref (line deleted since this formula was resolved) is filtered out here rather
    // than left to break the graph walk — SectionEditor already surfaces it as an editor warning.
    const refs = line.formula ? collectRefIds(line.formula).filter((id) => idSet.has(id)) : [];
    precedents.set(line.id, refs);
    for (const ref of refs) dependents.get(ref)!.push(line.id);
  }

  return { lineIds, precedents, dependents, order: tarjanOrder(lineIds, precedents) };
}

/**
 * Tarjan's strongly-connected-components algorithm, iterative (no recursion — a real schema's
 * dependency chain can run deeper than a safe call-stack depth). Over the "depends on" edges
 * (line -> its precedents), an SCC is completed only once every line it depends on has been
 * fully explored, so completion order is already precedents-before-dependents — exactly the
 * evaluation order needed, no reversal required.
 */
function tarjanOrder(lineIds: string[], precedents: Map<string, string[]>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  type Frame = { node: string; neighbors: string[]; i: number };

  for (const start of lineIds) {
    if (index.has(start)) continue;

    const callStack: Frame[] = [{ node: start, neighbors: precedents.get(start) ?? [], i: 0 }];
    index.set(start, counter);
    lowlink.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      if (frame.i < frame.neighbors.length) {
        const w = frame.neighbors[frame.i++];
        if (!index.has(w)) {
          index.set(w, counter);
          lowlink.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          callStack.push({ node: w, neighbors: precedents.get(w) ?? [], i: 0 });
        } else if (onStack.has(w)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node)!, index.get(w)!));
        }
      } else {
        callStack.pop();
        const parent = callStack[callStack.length - 1];
        if (parent) {
          lowlink.set(parent.node, Math.min(lowlink.get(parent.node)!, lowlink.get(frame.node)!));
        }
        if (lowlink.get(frame.node) === index.get(frame.node)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== frame.node);
          sccs.push(scc);
        }
      }
    }
  }

  return sccs;
}
