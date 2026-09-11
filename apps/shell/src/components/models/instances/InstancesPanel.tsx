import { Card, DataTable } from '@basis/design-system';
import type { LineInstance, StatementSchema, Timeline } from '../../../data';
import type { EvaluationResult } from '../../../lib/engine/evaluate';
import { DriverValueInput, formatDriverValue } from '../DriverValueInput';
import { basisLineLabel, INSTANCE_PROJECTION_METHOD_OPTIONS } from './projectionMethod';

/** One line/section this model has (or could have) sub-lines against — the unit InstancesPanel
 *  renders a block for. A `lineId` target rolls its instances up (see StatementLine.allowsSubLines'
 *  doc comment); a `sectionId` target is freeform (KPIs) and has no rollup. */
export interface InstanceTarget {
  id: string;
  name: string;
  kind: 'line' | 'section';
}

/** Every allowsSubLines line and allowsFreeformLines section in a schema, in the order they
 *  appear — the set InstancesPanel renders one block per. */
export function instanceTargetsOf(schema: StatementSchema): InstanceTarget[] {
  const targets: InstanceTarget[] = [];
  for (const section of schema.sections) {
    if (section.allowsFreeformLines) targets.push({ id: section.id, name: section.name, kind: 'section' });
    for (const line of section.lines) {
      if (line.allowsSubLines) targets.push({ id: line.id, name: line.name, kind: 'line' });
    }
  }
  return targets;
}

interface InstancesPanelProps {
  schema: StatementSchema;
  /** Every instance for the current model — read-only structure display; see the mapping
   *  screen's own instance editor for create/rename/delete/method/basis (Phase 9 revision:
   *  structure is a mapping-time decision now, same as an ordinary line's projection method is a
   *  schema-time decision — this panel only fills in driver values, like the Drivers card). */
  allInstances: LineInstance[];
  timeline: Timeline;
  /** This case's (Base or the active scenario's) own explicit driver values — same map
   *  `DriverValueInput` already reads for the main Drivers card; an instance's driverId is just
   *  another key into it. */
  activeStoredDriverValues: Record<string, (number | null)[]>;
  evaluation: EvaluationResult | null;
  onUpdateDriverValue: (driverId: string, periodIndex: number, value: number | null) => void;
}

export function InstancesPanel({ schema, allInstances, timeline, activeStoredDriverValues, evaluation, onUpdateDriverValue }: InstancesPanelProps) {
  const targets = instanceTargetsOf(schema);
  if (targets.length === 0) return null;

  const lineNameById = new Map(schema.sections.flatMap((s) => s.lines).map((l) => [l.id, l.name]));
  const projectedPeriods = timeline.map((period, index) => ({ period, index })).filter(({ period }) => period.kind === 'projected');

  return (
    <Card title="Segments, adjustments & KPIs" padding="none">
      <p style={{ margin: 0, padding: 'var(--space-4) var(--space-6) 0', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
        Structure (name, source mapping, method, basis) is managed from Edit mapping. Only driver values are edited here.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {targets.map((target) => (
          <InstanceTargetBlock
            key={target.id}
            target={target}
            instances={allInstances.filter((i) => (target.kind === 'line' ? i.lineId === target.id : i.sectionId === target.id))}
            allInstances={allInstances}
            lineNameById={lineNameById}
            projectedPeriods={projectedPeriods}
            activeStoredDriverValues={activeStoredDriverValues}
            evaluation={evaluation}
            onUpdateDriverValue={onUpdateDriverValue}
          />
        ))}
      </div>
    </Card>
  );
}

function InstanceTargetBlock({
  target, instances, allInstances, lineNameById, projectedPeriods, activeStoredDriverValues, evaluation, onUpdateDriverValue,
}: {
  target: InstanceTarget;
  instances: LineInstance[];
  allInstances: LineInstance[];
  lineNameById: Map<string, string>;
  projectedPeriods: { period: Timeline[number]; index: number }[];
  activeStoredDriverValues: Record<string, (number | null)[]>;
  evaluation: EvaluationResult | null;
  onUpdateDriverValue: (driverId: string, periodIndex: number, value: number | null) => void;
}) {
  const columns = [
    {
      key: 'name',
      label: 'Name',
      width: 200,
      render: (_: unknown, row: LineInstance) => (
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{row.name}</span>
      ),
    },
    {
      key: 'method',
      label: 'Method',
      width: 150,
      render: (_: unknown, row: LineInstance) => (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {INSTANCE_PROJECTION_METHOD_OPTIONS.find((o) => o.value === row.projection.method)?.label ?? row.projection.method}
        </span>
      ),
    },
    {
      key: 'basis',
      label: 'Basis line',
      width: 200,
      render: (_: unknown, row: LineInstance) => {
        const label = 'basisLineId' in row.projection ? basisLineLabel(row.projection.basisLineId, allInstances, lineNameById) : null;
        return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label ?? '—'}</span>;
      },
    },
    ...projectedPeriods.map(({ period, index }) => ({
      key: `p${index}`,
      label: period.label,
      numeric: true,
      width: 100,
      render: (_: unknown, row: LineInstance) => {
        if (row.projection.method === 'flat') {
          return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>—</span>;
        }
        const driverId = row.projection.driverId;
        const effective = evaluation?.getDriverValue(driverId, index) ?? null;
        return (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)' }}>
            {formatDriverValue(effective, row.projection.method === 'days-of' ? 'days' : '%')}
          </span>
        );
      },
      canEdit: (row: LineInstance) => row.projection.method !== 'flat',
      renderEdit: (_: unknown, row: LineInstance, wasEditCancelled: () => boolean) => {
        if (row.projection.method === 'flat') return null;
        const driverId = row.projection.driverId;
        return (
          <DriverValueInput
            stored={activeStoredDriverValues[driverId]?.[index] ?? null}
            unit={row.projection.method === 'days-of' ? 'days' : '%'}
            onCommit={(value) => onUpdateDriverValue(driverId, index, value)}
            wasEditCancelled={wasEditCancelled}
          />
        );
      },
    })),
  ];

  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ padding: 'var(--space-4) var(--space-6) 0', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-secondary)' }}>
        {target.name}
      </div>
      {instances.length > 0 ? (
        <DataTable columns={columns} rows={instances} rowKey="id" dense />
      ) : (
        <div style={{ padding: 'var(--space-3) var(--space-6) var(--space-5)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          No {target.kind === 'section' ? 'rows' : 'sub-lines'} yet. Add one from Edit mapping.
        </div>
      )}
    </div>
  );
}
