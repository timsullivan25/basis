import { useState } from 'react';
import { Button, Card, DataTable, IconButton, Input, Select } from '@basis/design-system';
import type { LineInstance, ProjectionMethod, StatementSchema, Timeline } from '../../../data';
import type { EvaluationResult } from '../../../lib/engine/evaluate';
import { DriverValueInput, formatDriverValue } from '../DriverValueInput';

/** Mirrors SectionEditor's ProjectionSelection, minus 'none' — unlike a schema StatementLine, a
 *  LineInstance has no hand-authored-formula escape hatch (see LineInstance.projection's own
 *  type), so every instance always has SOME projection method. */
export type InstanceProjectionSelection =
  | { method: 'flat' }
  | { method: 'growth' }
  | { method: 'percent-of' | 'days-of'; basisLineId: string };

const INSTANCE_PROJECTION_METHOD_OPTIONS: { value: 'flat' | ProjectionMethod; label: string }[] = [
  { value: 'flat', label: 'Flat (holds last actual)' },
  { value: 'growth', label: 'Growth Rate' },
  { value: 'percent-of', label: 'Percent of…' },
  { value: 'days-of', label: 'Days of…' },
];

function needsBasisLine(method: 'flat' | ProjectionMethod): method is 'percent-of' | 'days-of' {
  return method === 'percent-of' || method === 'days-of';
}

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
  /** Every instance for the current model — InstancesPanel derives each block's own rows, and
   *  the sibling-instance basis-picker group (see "Sibling-instance basis" in the Phase 9 plan),
   *  from this single list. */
  allInstances: LineInstance[];
  timeline: Timeline;
  /** This case's (Base or the active scenario's) own explicit driver values — same map
   *  `DriverValueInput` already reads for the main Drivers card; an instance's driverId is just
   *  another key into it. */
  activeStoredDriverValues: Record<string, (number | null)[]>;
  evaluation: EvaluationResult | null;
  onCreate: (target: InstanceTarget, name: string) => void;
  onRename: (instanceId: string, name: string) => void;
  onDelete: (instanceId: string) => void;
  onSetProjection: (instanceId: string, selection: InstanceProjectionSelection) => void;
  onUpdateDriverValue: (driverId: string, periodIndex: number, value: number | null) => void;
}

export function InstancesPanel({
  schema, allInstances, timeline, activeStoredDriverValues, evaluation,
  onCreate, onRename, onDelete, onSetProjection, onUpdateDriverValue,
}: InstancesPanelProps) {
  const targets = instanceTargetsOf(schema);
  if (targets.length === 0) return null;

  const lineNameById = new Map(schema.sections.flatMap((s) => s.lines).map((l) => [l.id, l.name]));
  const schemaLineGroups = schema.sections.map((s) => ({
    sectionName: s.name,
    lines: s.lines.map((l) => ({ id: l.id, name: l.name })),
  }));
  const projectedPeriods = timeline.map((period, index) => ({ period, index })).filter(({ period }) => period.kind === 'projected');

  return (
    <Card title="Segments, adjustments & KPIs" padding="none">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {targets.map((target) => (
          <InstanceTargetBlock
            key={target.id}
            target={target}
            instances={allInstances.filter((i) => (target.kind === 'line' ? i.lineId === target.id : i.sectionId === target.id))}
            allInstances={allInstances}
            lineNameById={lineNameById}
            schemaLineGroups={schemaLineGroups}
            projectedPeriods={projectedPeriods}
            activeStoredDriverValues={activeStoredDriverValues}
            evaluation={evaluation}
            onCreate={(name) => onCreate(target, name)}
            onRename={onRename}
            onDelete={onDelete}
            onSetProjection={onSetProjection}
            onUpdateDriverValue={onUpdateDriverValue}
          />
        ))}
      </div>
    </Card>
  );
}

function InstanceTargetBlock({
  target, instances, allInstances, lineNameById, schemaLineGroups, projectedPeriods,
  activeStoredDriverValues, evaluation, onCreate, onRename, onDelete, onSetProjection, onUpdateDriverValue,
}: {
  target: InstanceTarget;
  instances: LineInstance[];
  allInstances: LineInstance[];
  lineNameById: Map<string, string>;
  schemaLineGroups: { sectionName: string; lines: { id: string; name: string }[] }[];
  projectedPeriods: { period: Timeline[number]; index: number }[];
  activeStoredDriverValues: Record<string, (number | null)[]>;
  evaluation: EvaluationResult | null;
  onCreate: (name: string) => void;
  onRename: (instanceId: string, name: string) => void;
  onDelete: (instanceId: string) => void;
  onSetProjection: (instanceId: string, selection: InstanceProjectionSelection) => void;
  onUpdateDriverValue: (driverId: string, periodIndex: number, value: number | null) => void;
}) {
  const [newName, setNewName] = useState('');

  function submitCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewName('');
  }

  const columns = [
    {
      key: 'name',
      label: 'Name',
      width: 200,
      render: (_: unknown, row: LineInstance) => (
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{row.name}</span>
      ),
      renderEdit: (_: unknown, row: LineInstance) => (
        <Input size="sm" autoFocus selectOnFocus value={row.name} onChange={(e) => onRename(row.id, e.target.value)} />
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
      renderEdit: (_: unknown, row: LineInstance) => (
        <MethodEditor
          instance={row}
          schemaLineGroups={schemaLineGroups}
          allInstances={allInstances}
          lineNameById={lineNameById}
          onSetProjection={onSetProjection}
        />
      ),
    },
    {
      key: 'basis',
      label: 'Basis line',
      width: 200,
      render: (_: unknown, row: LineInstance) => {
        if (!('basisLineId' in row.projection) || !row.projection.basisLineId) return null;
        const basisId = row.projection.basisLineId;
        const schemaName = lineNameById.get(basisId);
        const instanceName = allInstances.find((i) => i.id === basisId)?.name;
        const parentName = schemaName ?? (instanceName && lineNameById.get(allInstances.find((i) => i.id === basisId)?.lineId ?? ''));
        return (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {instanceName ? `${parentName ?? '?'} → ${instanceName}` : (schemaName ?? '—')}
          </span>
        );
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
    {
      key: 'actions',
      label: '',
      width: 50,
      align: 'right' as const,
      render: (_: unknown, row: LineInstance) => (
        <div onClick={(e) => e.stopPropagation()}>
          <IconButton icon="trash-2" label="Delete instance" size="sm" variant="ghost" onClick={() => onDelete(row.id)} />
        </div>
      ),
    },
  ];

  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ padding: 'var(--space-4) var(--space-6) 0', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-secondary)' }}>
        {target.name}
      </div>
      {instances.length > 0 ? (
        <DataTable columns={columns} rows={instances} rowKey="id" dense />
      ) : (
        <div style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          No {target.kind === 'section' ? 'rows' : 'sub-lines'} yet.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-6) var(--space-5)' }}>
        <Input
          size="sm"
          fullWidth={false}
          style={{ width: 200 }}
          placeholder={target.kind === 'section' ? 'New KPI name' : 'New sub-line name'}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitCreate();
          }}
        />
        <Button size="sm" variant="ghost" iconLeft="plus" onClick={submitCreate} disabled={!newName.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function MethodEditor({
  instance, schemaLineGroups, allInstances, lineNameById, onSetProjection,
}: {
  instance: LineInstance;
  schemaLineGroups: { sectionName: string; lines: { id: string; name: string }[] }[];
  allInstances: LineInstance[];
  lineNameById: Map<string, string>;
  onSetProjection: (instanceId: string, selection: InstanceProjectionSelection) => void;
}) {
  const [pendingMethod, setPendingMethod] = useState<'percent-of' | 'days-of' | null>(null);
  const currentMethod = pendingMethod ?? instance.projection.method;
  const currentBasisLineId = pendingMethod ? '' : ('basisLineId' in instance.projection ? (instance.projection.basisLineId ?? '') : '');

  function handleMethodChange(method: 'flat' | ProjectionMethod) {
    if (needsBasisLine(method)) {
      setPendingMethod(method);
      return;
    }
    setPendingMethod(null);
    onSetProjection(instance.id, method === 'flat' ? { method: 'flat' } : { method: 'growth' });
  }

  function handleBasisLineChange(basisLineId: string) {
    if (!needsBasisLine(currentMethod) || !basisLineId) return;
    onSetProjection(instance.id, { method: currentMethod, basisLineId });
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
                .filter((i) => i.id !== instance.id && i.lineId !== undefined)
                .map((i) => ({ value: i.id, label: `${lineNameById.get(i.lineId!) ?? '?'} → ${i.name}` })),
            },
          ].filter((g) => g.options.length > 0)}
          onChange={(e) => handleBasisLineChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}
