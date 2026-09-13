import { useState } from 'react';
import { Button, Input } from '@basis/design-system';
import type { LineInstance, LineInstanceContent, ParsedWorkbook } from '../../../data';
import { SourceLineChecklist } from './SourceLineChecklist';
import { ManualHistoricalsInput } from './ManualHistoricalsInput';
import { ProjectionMethodEditor, type InstanceProjectionSelection, type SchemaLineGroup } from '../instances/projectionMethod';
import { DebtTranchePropertiesEditor } from '../instances/DebtTranchePropertiesEditor';

/** One row's worth of not-yet-(or already-)persisted instance state — see ModelMappingScreen's
 *  own doc comment for why this is unified rather than split into "existing" vs "draft" lists. */
export interface EditableInstance extends Partial<LineInstanceContent> {
  id: string;
  isNew: boolean;
  lineId?: string;
  sectionId?: string;
  name: string;
  sourceLineIds: string[];
  projection: LineInstance['projection'];
  /** Index-aligned with workbook.periods — see ManualHistoricalsInput. Only ever read/persisted
   *  when sourceLineIds is empty. */
  manualHistoricals: (number | null)[];
}

interface InstanceRowDetailProps {
  instance: EditableInstance;
  sectionName: string;
  workbook: ParsedWorkbook;
  schemaLineGroups: SchemaLineGroup[];
  /** Every other instance in this model, for the sibling-instance-basis group in the method
   *  picker — see ProjectionMethodEditor. */
  allInstances: LineInstance[];
  lineNameById: Map<string, string>;
  /** Set when this instance's parent line has StatementLine.subLineKind === 'debt' — shows the
   *  debt-specific property fields (maturity, coupon, etc.) below the usual ones, and replaces the
   *  projection-method picker (see below). `allowsRevolver` mirrors the parent line's own flag,
   *  which schema (not a hardcoded "only 1L" rule) decides. */
  debtLineFlags: { allowsRevolver: boolean } | null;
  onChangeName: (name: string) => void;
  onChangeSourceLines: (sourceLineIds: string[]) => void;
  onChangeManualHistoricals: (values: (number | null)[]) => void;
  onChangeProjection: (selection: InstanceProjectionSelection) => void;
  onChangeDebtFields: (patch: Partial<LineInstanceContent>) => void;
  onDelete: () => void;
}

/** The full editor for one sub-line/KPI instance — name, source mapping, and projection
 *  method/basis, all in one place. Used for both a brand-new instance (added via the "+ Add
 *  sub-line/KPI" row, held as a draft until Save) and an already-persisted one being revisited —
 *  mapping is the sole place instance structure is edited now; the model workspace's Drivers card
 *  only fills in driver values (see the Phase 9 revision plan). An instance with no source line
 *  mapped can have its historicals typed in directly instead (ManualHistoricalsInput) — a source
 *  mapping and manual entry are mutually exclusive; picking a source line always wins once one is
 *  set, matching every other line's "mapped value wins" rule. */
export function InstanceRowDetail({
  instance, sectionName, workbook, schemaLineGroups, allInstances, lineNameById, debtLineFlags,
  onChangeName, onChangeSourceLines, onChangeManualHistoricals, onChangeProjection, onChangeDebtFields, onDelete,
}: InstanceRowDetailProps) {
  const [manualEntry, setManualEntry] = useState(
    instance.sourceLineIds.length === 0 && instance.manualHistoricals.some((v) => v !== null),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--space-9)' }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {manualEntry ? (
            <ManualHistoricalsInput workbook={workbook} values={instance.manualHistoricals} onChange={onChangeManualHistoricals} />
          ) : (
            <SourceLineChecklist
              title={`Map ${instance.name.trim() || (instance.sectionId ? 'new KPI' : 'new sub-line')} from`}
              sectionName={sectionName}
              workbook={workbook}
              sourceLineIds={instance.sourceLineIds}
              onSetSourceLines={onChangeSourceLines}
            />
          )}
          {instance.sourceLineIds.length === 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setManualEntry((prev) => !prev)}>
              {manualEntry ? 'Map from the uploaded file instead' : 'Not in the uploaded file? Enter values manually'}
            </Button>
          ) : null}
        </div>

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            {instance.sectionId ? 'KPI' : 'Sub-line'} name
          </div>
          <Input
            size="sm"
            autoFocus={!instance.name}
            value={instance.name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder={instance.sectionId ? 'e.g. Monthly Active Users' : 'e.g. Segment A'}
          />

          {debtLineFlags ? (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: 'var(--space-3)' }}>
              Projected as a flat carry-forward until Debt Schedule ships — a debt tranche's
              balance doesn't fit growth/percent-of/days-of/roll-off, and will instead be driven
              entirely by Debt Schedule's roll-forward once that exists.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginTop: 'var(--space-3)' }}>
                Projection method
              </div>
              <ProjectionMethodEditor
                projection={instance.projection}
                excludeInstanceId={instance.id}
                schemaLineGroups={schemaLineGroups}
                allInstances={allInstances}
                lineNameById={lineNameById}
                onChange={onChangeProjection}
              />
            </>
          )}

          {debtLineFlags ? (
            <DebtTranchePropertiesEditor instance={instance} canBeRevolver={debtLineFlags.allowsRevolver} onChange={onChangeDebtFields} />
          ) : null}

          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button size="sm" variant="ghost" iconLeft="trash-2" onClick={onDelete}>
              {instance.isNew ? 'Discard' : 'Delete'} {instance.sectionId ? 'KPI' : 'sub-line'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
