import { useState } from 'react';
import { Select } from '@basis/design-system';
import type { ProjectionMethod, StatementLine } from '../../../data';
import type { ChildProjectionSelection } from '../../../lib/statementLineChildren';

export const INSTANCE_PROJECTION_METHOD_OPTIONS: { value: 'flat' | ProjectionMethod; label: string }[] = [
  { value: 'flat', label: 'Flat (holds last actual)' },
  { value: 'growth', label: 'Growth Rate' },
  { value: 'percent-of', label: 'Percent of…' },
  { value: 'days-of', label: 'Days of…' },
  { value: 'roll-off', label: 'Roll-off' },
  { value: 'actual', label: 'Actual' },
];

export function needsBasisLine(method: 'flat' | ProjectionMethod): method is 'percent-of' | 'days-of' | 'roll-off' {
  return method === 'percent-of' || method === 'days-of' || method === 'roll-off';
}

/** One line/section a model has (or could have) child lines against — a `lineId` target rolls
 *  its children up into that line (see StatementLine.allowsSubLines' own doc comment); a
 *  `sectionId` target is freeform (KPIs) and has no rollup. Used by the mapping screen's
 *  "+ Add sub-line/KPI" row builder. */
export interface InstanceTarget {
  id: string;
  name: string;
  kind: 'line' | 'section';
}

export interface SchemaLineGroup {
  sectionName: string;
  lines: { id: string; name: string }[];
}

/** The method + basis-line control for a single line — shared by the mapping screen's child-line
 *  creator/editor and (read-only elsewhere) the model workspace's structure display. A basis
 *  line is now just any other schema line (children are ordinary StatementLines, living in
 *  `schemaLineGroups` like everything else) — there's no more separate "sibling instance"
 *  grouping to maintain, since a sibling tranche/segment IS a schema line now. */
export function ProjectionMethodEditor({
  projection, basisLineId, excludeLineId, schemaLineGroups, onChange,
}: {
  projection: StatementLine['projection'];
  /** The current driver's basisLineId, resolved by the caller from schema.drivers — not carried
   *  inline on `projection` (StatementLine.projection never has one; that's the schema's own
   *  DriverDefinition's job). */
  basisLineId: string | undefined;
  /** Exclude this line from the basis picker — itself can't be its own basis. Omit for a
   *  not-yet-created draft (nothing to exclude). */
  excludeLineId?: string;
  schemaLineGroups: SchemaLineGroup[];
  onChange: (selection: ChildProjectionSelection) => void;
}) {
  const [pendingMethod, setPendingMethod] = useState<'percent-of' | 'days-of' | 'roll-off' | null>(null);
  const currentMethod = pendingMethod ?? projection?.method ?? 'flat';
  const currentBasisLineId = pendingMethod ? '' : (basisLineId ?? '');

  function handleMethodChange(method: 'flat' | ProjectionMethod) {
    if (needsBasisLine(method)) {
      setPendingMethod(method);
      return;
    }
    setPendingMethod(null);
    onChange(method === 'flat' ? { method: 'flat' } : method === 'actual' ? { method: 'actual' } : { method: 'growth' });
  }

  function handleBasisLineChange(newBasisLineId: string) {
    if (!needsBasisLine(currentMethod) || !newBasisLineId) return;
    onChange({ method: currentMethod, basisLineId: newBasisLineId });
    setPendingMethod(null);
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <Select
        size="sm"
        fullWidth={false}
        style={{ width: 140 }}
        options={INSTANCE_PROJECTION_METHOD_OPTIONS}
        value={currentMethod}
        onChange={(e) => handleMethodChange(e.target.value as 'flat' | ProjectionMethod)}
      />
      {needsBasisLine(currentMethod) ? (
        <Select
          size="sm"
          fullWidth={false}
          style={{ width: 180 }}
          value={currentBasisLineId}
          options={[{ value: '', label: 'None / N/A' }]}
          groups={schemaLineGroups
            .map((g) => ({ label: g.sectionName, options: g.lines.filter((l) => l.id !== excludeLineId).map((l) => ({ value: l.id, label: l.name })) }))
            .filter((g) => g.options.length > 0)}
          onChange={(e) => handleBasisLineChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}
