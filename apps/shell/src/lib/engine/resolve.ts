import { parseFormula, type FormulaAst } from './parse';
import type { ResolvedFormula, StatementLine } from '../../data';

export type { ResolvedFormula };

interface Candidate {
  text: string;
  lineId: string;
  qualified: boolean;
  /** Only for a qualified candidate: the length of its leading "Section." — see
   *  NameIndex.qualifierLength. */
  qualifierLength: number;
}

/** The only shape buildNameIndex actually needs — deliberately looser than StatementSchema so
 *  it also accepts a schema still under construction, before formulas are compiled. `drivers` is
 *  separate from `sections` on purpose — a driver is never typed by name into the formula bar
 *  (see NameIndex.describeDriver), so it never enters the tokenizer's candidate vocabulary. */
export interface NameIndexInput {
  sections: Array<{ name: string; lines: Array<{ id: string; name: string }> }>;
  drivers?: Array<{ id: string; name: string }>;
}

/** One line offered by autocomplete. `insertText` is what gets typed into the formula: the
 *  qualified "Section.Name" form exactly when another line ANYWHERE in the schema shares the
 *  name — the same rule formatFormula uses to display a reference, so what autocomplete inserts
 *  and what reopening the line shows always match. */
export interface NameSuggestion {
  lineId: string;
  name: string;
  sectionName: string;
  insertText: string;
  qualified: boolean;
}

export interface NameIndex {
  /** Every matchable string — plain name, plus "Section.Name" for every line — fed straight
   *  into tokenize()/parseFormula() as the candidate list. */
  candidates(): string[];
  /** Resolves a token's matched text to a specific line, excluding `fromLineId` (so a
   *  pull-through line's self-reference narrows to the one other candidate with no
   *  qualification needed). A qualified match is always unambiguous. A plain match with
   *  more than one remaining candidate after self-exclusion is a genuine ambiguity. */
  resolve(matchedText: string, fromLineId: string): { ok: true; lineId: string } | { ok: false; error: string };
  /** Current display name for a line, and whether some other line currently shares its
   *  (unqualified) name — used by formatFormula to decide whether to qualify on display. */
  describe(lineId: string): { name: string; qualifiedName: string; ambiguous: boolean } | undefined;
  /** Autocomplete entries for a formula being edited on `fromLineId`: every other named line,
   *  once each, in schema order (the caller filters and ranks by what's typed). Never the line
   *  itself — a bare self-reference wouldn't resolve, and it would self-cycle anyway. */
  suggestions(fromLineId: string): NameSuggestion[];
  /** How many leading characters of `matchedText` are a "Section." qualifier (0 when it isn't a
   *  qualified reference) — lets the formula editor show the qualifier less prominently than the
   *  line name that follows it. */
  qualifierLength(matchedText: string): number;
  /** Current display name for a driver — used by formatFormula to render a driverRef node. No
   *  ambiguity/qualification concept (unlike describe()), since a driver is never resolved from
   *  typed text — this is display-only. */
  describeDriver(driverId: string): { name: string } | undefined;
}

export function buildNameIndex(schema: NameIndexInput): NameIndex {
  const entries: { line: { id: string; name: string }; section: { name: string } }[] = [];
  schema.sections.forEach((section) => {
    section.lines.forEach((line) => entries.push({ line, section }));
  });
  const drivers = schema.drivers ?? [];

  const byNameKey = new Map<string, { lineId: string; sectionName: string }[]>();
  for (const { line, section } of entries) {
    const key = line.name.trim().toLowerCase();
    if (!key) continue;
    const group = byNameKey.get(key) ?? [];
    group.push({ lineId: line.id, sectionName: section.name });
    byNameKey.set(key, group);
  }

  const candidateList: Candidate[] = [];
  for (const { line, section } of entries) {
    if (!line.name.trim()) continue;
    candidateList.push({ text: line.name, lineId: line.id, qualified: false, qualifierLength: 0 });
    candidateList.push({ text: `${section.name}.${line.name}`, lineId: line.id, qualified: true, qualifierLength: section.name.length + 1 });
  }

  return {
    candidates: () => candidateList.map((c) => c.text),

    resolve(matchedText, fromLineId) {
      const qualifiedMatch = candidateList.find((c) => c.qualified && c.text === matchedText);
      if (qualifiedMatch) return { ok: true, lineId: qualifiedMatch.lineId };

      const key = matchedText.trim().toLowerCase();
      const group = (byNameKey.get(key) ?? []).filter((g) => g.lineId !== fromLineId);
      if (group.length === 1) return { ok: true, lineId: group[0].lineId };
      if (group.length === 0) return { ok: false, error: `Unknown line: ${matchedText}` };
      const options = group.map((g) => `${g.sectionName}.${matchedText}`).join(' or ');
      return { ok: false, error: `"${matchedText}" is ambiguous — qualify it as ${options}` };
    },

    describe(lineId) {
      const found = entries.find((e) => e.line.id === lineId);
      if (!found) return undefined;
      const key = found.line.name.trim().toLowerCase();
      const group = byNameKey.get(key) ?? [];
      return {
        name: found.line.name,
        qualifiedName: `${found.section.name}.${found.line.name}`,
        ambiguous: group.length > 1,
      };
    },

    suggestions(fromLineId) {
      const result: NameSuggestion[] = [];
      for (const { line, section } of entries) {
        if (line.id === fromLineId || !line.name.trim()) continue;
        const qualified = (byNameKey.get(line.name.trim().toLowerCase()) ?? []).length > 1;
        result.push({
          lineId: line.id,
          name: line.name,
          sectionName: section.name,
          insertText: qualified ? `${section.name}.${line.name}` : line.name,
          qualified,
        });
      }
      return result;
    },

    qualifierLength(matchedText) {
      const lower = matchedText.toLowerCase();
      return candidateList.find((c) => c.qualified && c.text.toLowerCase() === lower)?.qualifierLength ?? 0;
    },

    describeDriver(driverId) {
      const found = drivers.find((d) => d.id === driverId);
      return found ? { name: found.name } : undefined;
    },
  };
}

function resolveAst(
  ast: FormulaAst,
  index: NameIndex,
  ownLineId: string,
): { ok: true; formula: ResolvedFormula } | { ok: false; errors: string[] } {
  if (ast.kind === 'num') return { ok: true, formula: { kind: 'num', value: ast.value } };
  if (ast.kind === 'ref') {
    const r = index.resolve(ast.name, ownLineId);
    if (!r.ok) return { ok: false, errors: [r.error] };
    return { ok: true, formula: { kind: 'ref', lineId: r.lineId } };
  }
  if (ast.kind === 'neg') {
    const inner = resolveAst(ast.arg, index, ownLineId);
    if (!inner.ok) return inner;
    return { ok: true, formula: { kind: 'neg', arg: inner.formula } };
  }
  if (ast.kind === 'bin') {
    const left = resolveAst(ast.left, index, ownLineId);
    if (!left.ok) return left;
    const right = resolveAst(ast.right, index, ownLineId);
    if (!right.ok) return right;
    return { ok: true, formula: { kind: 'bin', op: ast.op, left: left.formula, right: right.formula } };
  }
  const args: ResolvedFormula[] = [];
  for (const a of ast.args) {
    const res = resolveAst(a, index, ownLineId);
    if (!res.ok) return res;
    args.push(res.formula);
  }
  return { ok: true, formula: { kind: 'call', fn: ast.fn, args } };
}

export type CompileResult = { ok: true; formula: ResolvedFormula | null } | { ok: false; errors: string[] };

/** tokenize + parseFormula + per-ref resolve, in one call — every formula-editing surface
 *  (FormulaInput, seed construction) uses this to turn typed text into what's actually stored.
 *  Empty text compiles to `formula: null` ("not calculated"), not an error. */
export function compileFormula(text: string, index: NameIndex, ownLineId: string): CompileResult {
  if (!text.trim()) return { ok: true, formula: null };
  const parsed = parseFormula(text, index.candidates());
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return resolveAst(parsed.ast, index, ownLineId);
}

function precedence(f: ResolvedFormula): number {
  if (f.kind === 'neg') return 4;
  if (f.kind === 'bin') return f.op === '^' ? 3 : f.op === '*' || f.op === '/' ? 2 : 1;
  return 5; // num, ref, driverRef, call
}

function formatNode(f: ResolvedFormula, index: NameIndex, minPrec: number): string {
  const p = precedence(f);
  const wrap = (s: string) => (p < minPrec ? `(${s})` : s);
  if (f.kind === 'num') return String(f.value);
  if (f.kind === 'ref') {
    const d = index.describe(f.lineId);
    return d ? (d.ambiguous ? d.qualifiedName : d.name) : '<unknown line>';
  }
  if (f.kind === 'driverRef') {
    const d = index.describeDriver(f.driverId);
    return d ? d.name : '<unknown driver>';
  }
  if (f.kind === 'neg') return wrap(`-${formatNode(f.arg, index, 4)}`);
  if (f.kind === 'call') return `${f.fn}(${f.args.map((a) => formatNode(a, index, 0)).join(', ')})`;
  // bin — '^' is right-associative, everything else left-associative
  const leftMin = f.op === '^' ? p + 1 : p;
  const rightMin = f.op === '^' ? p : p + 1;
  return wrap(`${formatNode(f.left, index, leftMin)} ${f.op} ${formatNode(f.right, index, rightMin)}`);
}

/** Inverse of compileFormula — renders a resolved formula back to text using each ref's
 *  CURRENT name, qualifying only refs whose name is currently ambiguous (checked fresh
 *  against the schema every call, not stored) — so a rename or a later-introduced collision
 *  is reflected correctly without ever needing to rewrite stored data. */
export function formatFormula(formula: ResolvedFormula | null, index: NameIndex): string {
  return formula ? formatNode(formula, index, 0) : '';
}

/** Every lineId a resolved formula references, including nested calls — used to detect a
 *  dangling reference (a line deleted after something else's formula was resolved against it).
 *  Line ids only, by design — a driverRef's dangling-driver lifecycle is a separate concern with
 *  its own semantics, not folded in here. */
export function collectRefIds(formula: ResolvedFormula): string[] {
  if (formula.kind === 'num' || formula.kind === 'driverRef') return [];
  if (formula.kind === 'ref') return [formula.lineId];
  if (formula.kind === 'neg') return collectRefIds(formula.arg);
  if (formula.kind === 'bin') return [...collectRefIds(formula.left), ...collectRefIds(formula.right)];
  return formula.args.flatMap(collectRefIds);
}

/** Rewrites every `ref.lineId` and `driverRef.driverId` through `idMap` — the id-remap pass a
 *  schema duplicate needs, since every line and driver gets a fresh id on copy. Line ids and
 *  driver ids are separate uuid pools that can never collide, so one combined map covers both —
 *  the caller just needs to seed it with fresh ids for every line AND every driver being copied. */
export function remapFormulaIds(formula: ResolvedFormula, idMap: Map<string, string>): ResolvedFormula {
  if (formula.kind === 'num') return formula;
  if (formula.kind === 'ref') return { kind: 'ref', lineId: idMap.get(formula.lineId) ?? formula.lineId };
  if (formula.kind === 'driverRef') return { kind: 'driverRef', driverId: idMap.get(formula.driverId) ?? formula.driverId };
  if (formula.kind === 'neg') return { kind: 'neg', arg: remapFormulaIds(formula.arg, idMap) };
  if (formula.kind === 'bin') {
    return { kind: 'bin', op: formula.op, left: remapFormulaIds(formula.left, idMap), right: remapFormulaIds(formula.right, idMap) };
  }
  return { kind: 'call', fn: formula.fn, args: formula.args.map((a) => remapFormulaIds(a, idMap)) };
}

export function isCalculated(line: Pick<StatementLine, 'formula'>): boolean {
  return line.formula !== null;
}

// ---- Projection-method formula builders ---------------------------------------------------
// Used only by the schema editor's projection-method UI to construct a line's formula directly
// (never parsed from text — a driverRef is never hand-typed, see NameIndexInput's doc comment).

function ref(lineId: string): ResolvedFormula {
  return { kind: 'ref', lineId };
}
function driverRef(driverId: string): ResolvedFormula {
  return { kind: 'driverRef', driverId };
}
function num(value: number): ResolvedFormula {
  return { kind: 'num', value };
}
function priorPeriodOf(inner: ResolvedFormula): ResolvedFormula {
  return { kind: 'call', fn: 'priorPeriod', args: [inner] };
}
function lastActualOf(inner: ResolvedFormula): ResolvedFormula {
  return { kind: 'call', fn: 'lastActual', args: [inner] };
}

/** A pure carry-forward: this period repeats the line's own immediately preceding value. No
 *  driver at all — 'flat' needs no per-period assumption to hold constant. */
/** A Link projection — the line simply reads another line, period for period (negated when
 *  `flipSign`). */
export function buildLinkFormula(basisLineId: string, flipSign = false): ResolvedFormula {
  return flipSign ? { kind: 'neg', arg: ref(basisLineId) } : ref(basisLineId);
}

export function buildFlatFormula(lineId: string): ResolvedFormula {
  return priorPeriodOf(ref(lineId));
}

/** priorPeriod(self) * (1 + driver) — the driver is a period-over-period growth rate (0.05 = 5%). */
export function buildGrowthFormula(lineId: string, driverId: string): ResolvedFormula {
  return { kind: 'bin', op: '*', left: priorPeriodOf(ref(lineId)), right: { kind: 'bin', op: '+', left: num(1), right: driverRef(driverId) } };
}

/** basisLine * driver — 'percent-of', the driver being the fraction (0.3 = 30%). */
export function buildRatioFormula(basisLineId: string, driverId: string): ResolvedFormula {
  return { kind: 'bin', op: '*', left: ref(basisLineId), right: driverRef(driverId) };
}

/** (driver / 365) * basisLine — driver is a day-count (DSO/DPO/DIO-style working-capital driver). */
export function buildDaysFormula(basisLineId: string, driverId: string): ResolvedFormula {
  return { kind: 'bin', op: '*', left: { kind: 'bin', op: '/', left: driverRef(driverId), right: num(365) }, right: ref(basisLineId) };
}

/** lastActual(self) * (1 - driver) — a flat, non-compounding split of this line's own value at
 *  the model's last actual period: `driver` fraction rolls off onto the basis line every
 *  projected period (see withDynamicInstances.ts's injectRollOffContras), `1 - driver` is what
 *  continues showing on this line itself, forever, relative to the ORIGINAL base — never the
 *  prior period, unlike 'growth'. */
export function buildRollOffFormula(lineId: string, driverId: string): ResolvedFormula {
  return {
    kind: 'bin', op: '*',
    left: lastActualOf(ref(lineId)),
    right: { kind: 'bin', op: '-', left: num(1), right: driverRef(driverId) },
  };
}

/** The driver IS the value — a per-period hardcoded number, no computation at all. */
export function buildHardcodeFormula(driverId: string): ResolvedFormula {
  return driverRef(driverId);
}

// ---- Debt schedule formula builders --------------------------------------------------------
// Used only by lib/debtSchedule.ts's regenerateDebtSchedule to construct each generated line's
// formula directly — same "hand-build a ResolvedFormula, never parsed from text" convention as
// the projection-method builders above. No new engine capability: everything here is expressible
// with the existing ref/bin/call('sum'|'min'|'max'|'avg')/priorPeriod/lastActual nodes, and the
// same-period circularity a cash sweep + circular interest need (Ending depends on Repayment
// depends on cash flow depends on Interest depends on Ending) is exactly what evaluate.ts's
// existing Gauss-Seidel cyclic-group solver already exists to handle.

function sumOf(args: ResolvedFormula[]): ResolvedFormula {
  return { kind: 'call', fn: 'sum', args };
}
function minOf(a: ResolvedFormula, b: ResolvedFormula): ResolvedFormula {
  return { kind: 'call', fn: 'min', args: [a, b] };
}
function maxOf(a: ResolvedFormula, b: ResolvedFormula): ResolvedFormula {
  return { kind: 'call', fn: 'max', args: [a, b] };
}
function avgOf(a: ResolvedFormula, b: ResolvedFormula): ResolvedFormula {
  return { kind: 'call', fn: 'avg', args: [a, b] };
}
function sub(a: ResolvedFormula, b: ResolvedFormula): ResolvedFormula {
  return { kind: 'bin', op: '-', left: a, right: b };
}
function add(a: ResolvedFormula, b: ResolvedFormula): ResolvedFormula {
  return { kind: 'bin', op: '+', left: a, right: b };
}
function mul(a: ResolvedFormula, b: ResolvedFormula): ResolvedFormula {
  return { kind: 'bin', op: '*', left: a, right: b };
}

/** priorPeriod(tranche) — a tranche's own prior-period value IS its beginning balance, whether
 *  that prior period was actual (its real mapped historical) or projected (its own prior Ending
 *  Balance, since the tranche's own formula becomes `ref(endingBalanceLineId)` once the schedule
 *  is live — see regenerateDebtSchedule). */
export function buildDebtBeginningBalanceFormula(trancheLineId: string): ResolvedFormula {
  return priorPeriodOf(ref(trancheLineId));
}

/** Beginning − Amortization − Repayment + Borrowing — the standard roll-forward. */
export function buildDebtEndingBalanceFormula(
  beginningId: string,
  amortizationId: string,
  repaymentId: string,
  borrowingId: string,
): ResolvedFormula {
  return add(sub(sub(ref(beginningId), ref(amortizationId)), ref(repaymentId)), ref(borrowingId));
}

/** (an explicit original-face-value override, else this tranche's own value at the model's last
 *  actual period) × amortizationRate, prorated to the model's own period frequency. */
export function buildDebtAmortizationFormula(
  trancheLineId: string,
  originalFaceValue: number | undefined,
  amortizationRate: number,
  periodsPerYear: number,
): ResolvedFormula {
  const base = originalFaceValue !== undefined ? num(originalFaceValue) : lastActualOf(ref(trancheLineId));
  return mul(base, num(amortizationRate / periodsPerYear));
}

/** couponRate/periodsPerYear × (avg(Beginning, Ending) if circularCalcsEnabled, else Beginning
 *  alone). The avg() case is the genuine same-period circularity described above — nothing here
 *  special-cases it, the graph/evaluator already do. */
export function buildDebtInterestFormula(
  couponRate: number,
  periodsPerYear: number,
  beginningId: string,
  endingId: string,
  circularCalcsEnabled: boolean,
): ResolvedFormula {
  const balance = circularCalcsEnabled ? avgOf(ref(beginningId), ref(endingId)) : ref(beginningId);
  return mul(num(couponRate / periodsPerYear), balance);
}

/** Same balance-basis convention as interest — commitmentFeeRate/periodsPerYear × the undrawn
 *  portion of the commitment (commitmentAmount − drawn balance). */
export function buildDebtCommitmentFeeFormula(
  commitmentFeeRate: number,
  periodsPerYear: number,
  commitmentAmount: number,
  beginningId: string,
  endingId: string,
  circularCalcsEnabled: boolean,
): ResolvedFormula {
  const drawn = circularCalcsEnabled ? avgOf(ref(beginningId), ref(endingId)) : ref(beginningId);
  return mul(num(commitmentFeeRate / periodsPerYear), sub(num(commitmentAmount), drawn));
}

/** max(0, priorCash + FCF − minimumCashTarget) — the pool available to sweep toward repayment
 *  this period, before any tranche's own share is carved out (see buildDebtRepaymentFormula). */
export function buildCashAvailableForRepaymentFormula(
  cashLineId: string,
  fcfLineId: string,
  minimumCashDriverId: string,
): ResolvedFormula {
  return maxOf(num(0), sub(add(priorPeriodOf(ref(cashLineId)), ref(fcfLineId)), driverRef(minimumCashDriverId)));
}

/** max(0, minimumCashTarget − (priorCash + FCF)) — the gap a revolver draw needs to close. */
export function buildCashShortfallFormula(
  cashLineId: string,
  fcfLineId: string,
  minimumCashDriverId: string,
): ResolvedFormula {
  return maxOf(num(0), sub(driverRef(minimumCashDriverId), add(priorPeriodOf(ref(cashLineId)), ref(fcfLineId))));
}

/** min(max(0, cash remaining after every more-senior tranche's own Repayment), this tranche's own
 *  balance after mandatory amortization) — one link in the seniority waterfall chain; a
 *  non-repayable tranche never calls this (its Repayment is a flat 0 — see regenerateDebtSchedule),
 *  so the chain passes through it with no special case needed here. */
export function buildDebtRepaymentFormula(
  cashAvailableId: string,
  moreSeniorRepaymentIds: string[],
  beginningId: string,
  amortizationId: string,
): ResolvedFormula {
  const remaining =
    moreSeniorRepaymentIds.length === 0
      ? ref(cashAvailableId)
      : maxOf(num(0), sub(ref(cashAvailableId), sumOf(moreSeniorRepaymentIds.map(ref))));
  return minOf(remaining, sub(ref(beginningId), ref(amortizationId)));
}

/** min(shortfall, remaining undrawn capacity) — capped so a draw can never push the revolver past
 *  its own commitment. */
export function buildRevolverBorrowingFormula(
  cashShortfallId: string,
  commitmentAmount: number,
  beginningId: string,
): ResolvedFormula {
  return minOf(ref(cashShortfallId), sub(num(commitmentAmount), ref(beginningId)));
}

/** max(0, shortfall − remaining undrawn capacity) — nonzero exactly when the shortfall exceeds
 *  what the revolver can fund. With no revolver at all, the caller omits `beginningId`, collapsing
 *  capacity to 0 so this reduces to the shortfall itself — every unfunded dollar is a breach. */
export function buildRevolverBreachFormula(
  cashShortfallId: string,
  commitmentAmount: number,
  beginningId: string | undefined,
): ResolvedFormula {
  const capacity = beginningId ? sub(num(commitmentAmount), ref(beginningId)) : num(0);
  return maxOf(num(0), sub(ref(cashShortfallId), capacity));
}
