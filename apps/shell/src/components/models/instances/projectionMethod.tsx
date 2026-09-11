import { useState } from 'react';
import { Select } from '@basis/design-system';
import type { LineInstance, ProjectionMethod } from '../../../data';

/** Mirrors SectionEditor's ProjectionSelection, minus 'none' — unlike a schema StatementLine, a
 *  LineInstance has no hand-authored-formula escape hatch (see LineInstance.projection's own
 *  type), so every instance always has SOME projection method. */
export type InstanceProjectionSelection =
  | { method: 'flat' }
  | { method: 'growth' }
  | { method: 'percent-of' | 'days-of'; basisLineId: string };

export const INSTANCE_PROJECTION_METHOD_OPTIONS: { value: 'flat' | ProjectionMethod; label: string }[] = [
  { value: 'flat', label: 'Flat (holds last actual)' },
  { value: 'growth', label: 'Growth Rate' },
  { value: 'percent-of', label: 'Percent of…' },
  { value: 'days-of', label: 'Days of…' },
];

export function needsBasisLine(method: 'flat' | ProjectionMethod): method is 'percent-of' | 'days-of' {
  return method === 'percent-of' || method === 'days-of';
}

export interface SchemaLineGroup {
  sectionName: string;
  lines: { id: string; name: string }[];
}

/** The method + basis-line control for a single instance — shared by the mapping screen's
 *  instance creator/editor and (read-only elsewhere) the model workspace's structure display.
 *  Where an instance's projection actually gets set is a mapping-time decision now (see the
 *  Phase 9 revision plan); this is just the reusable control, not tied to either screen. */
export function ProjectionMethodEditor({
  projection, excludeInstanceId, schemaLineGroups, allInstances, lineNameById, onChange,
}: {
  projection: LineInstance['projection'];
  /** Exclude this instance from the sibling-basis group — itself can't be its own basis. Omit
   *  for a not-yet-created draft (nothing to exclude). */
  excludeInstanceId?: string;
  schemaLineGroups: SchemaLineGroup[];
  allInstances: LineInstance[];
  lineNameById: Map<string, string>;
  onChange: (selection: InstanceProjectionSelection) => void;
}) {
  const [pendingMethod, setPendingMethod] = useState<'percent-of' | 'days-of' | null>(null);
  const currentMethod = pendingMethod ?? projection.method;
  const currentBasisLineId = pendingMethod ? '' : ('basisLineId' in projection ? (projection.basisLineId ?? '') : '');

  function handleMethodChange(method: 'flat' | ProjectionMethod) {
    if (needsBasisLine(method)) {
      setPendingMethod(method);
      return;
    }
    setPendingMethod(null);
    onChange(method === 'flat' ? { method: 'flat' } : { method: 'growth' });
  }

  function handleBasisLineChange(basisLineId: string) {
    if (!needsBasisLine(currentMethod) || !basisLineId) return;
    onChange({ method: currentMethod, basisLineId });
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
          options={[{ value: '', label: 'Select a line…' }]}
          groups={[
            ...schemaLineGroups
              .map((g) => ({ label: g.sectionName, options: g.lines.map((l) => ({ value: l.id, label: l.name })) }))
              .filter((g) => g.options.length > 0),
            {
              label: 'This model’s segments',
              options: allInstances
                .filter((i) => i.id !== excludeInstanceId && i.lineId !== undefined)
                .map((i) => ({ value: i.id, label: `${lineNameById.get(i.lineId!) ?? '?'} → ${i.name}` })),
            },
          ].filter((g) => g.options.length > 0)}
          onChange={(e) => handleBasisLineChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}

/** Display label for an instance's current basis line, given either a schema line id or a
 *  sibling instance id — shared read-only rendering for InstancesPanel and mapping. */
export function basisLineLabel(
  basisLineId: string | undefined,
  allInstances: LineInstance[],
  lineNameById: Map<string, string>,
): string | null {
  if (!basisLineId) return null;
  const schemaName = lineNameById.get(basisLineId);
  if (schemaName) return schemaName;
  const instance = allInstances.find((i) => i.id === basisLineId);
  if (!instance) return null;
  const parentName = instance.lineId ? lineNameById.get(instance.lineId) : undefined;
  return `${parentName ?? '?'} → ${instance.name}`;
}
