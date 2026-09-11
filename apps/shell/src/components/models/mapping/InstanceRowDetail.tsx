import { Button, Input } from '@basis/design-system';
import type { LineInstance, ParsedWorkbook } from '../../../data';
import { SourceLineChecklist } from './SourceLineChecklist';
import { DriverValueInput } from '../DriverValueInput';
import { ProjectionMethodEditor, type InstanceProjectionSelection, type SchemaLineGroup } from '../instances/projectionMethod';

/** One row's worth of not-yet-(or already-)persisted instance state — see ModelMappingScreen's
 *  own doc comment for why this is unified rather than split into "existing" vs "draft" lists. */
export interface EditableInstance {
  id: string;
  isNew: boolean;
  lineId?: string;
  sectionId?: string;
  name: string;
  sourceLineIds: string[];
  projection: LineInstance['projection'];
}

interface InstanceRowDetailProps {
  instance: EditableInstance;
  sectionName: string;
  workbook: ParsedWorkbook;
  /** This instance's historical-period values, aligned 1:1 with workbook.periods — only read
   *  (and only editable) when sourceLineIds is empty; ignored otherwise since the derived value
   *  from the source mapping always wins. */
  manualValues: (number | null)[];
  schemaLineGroups: SchemaLineGroup[];
  /** Every other instance in this model, for the sibling-instance-basis group in the method
   *  picker — see ProjectionMethodEditor. */
  allInstances: LineInstance[];
  lineNameById: Map<string, string>;
  onChangeName: (name: string) => void;
  onChangeSourceLines: (sourceLineIds: string[]) => void;
  onChangeProjection: (selection: InstanceProjectionSelection) => void;
  onChangeManualValue: (periodIndex: number, value: number | null) => void;
  onDelete: () => void;
}

/** The full editor for one sub-line/KPI instance — name, source mapping (or manual entry when
 *  unmapped), and projection method/basis, all in one place. Used for both a brand-new instance
 *  (added via the "+ Add sub-line/KPI" row, held as a draft until Save) and an already-persisted
 *  one being revisited — mapping is the sole place instance structure is edited now; the model
 *  workspace's Drivers card only fills in driver values (see the Phase 9 revision plan). */
export function InstanceRowDetail({
  instance, sectionName, workbook, manualValues, schemaLineGroups, allInstances, lineNameById,
  onChangeName, onChangeSourceLines, onChangeProjection, onChangeManualValue, onDelete,
}: InstanceRowDetailProps) {
  const isManual = instance.sourceLineIds.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--space-9)' }}>
        <SourceLineChecklist
          title={`Map ${instance.name.trim() || (instance.sectionId ? 'new KPI' : 'new sub-line')} from`}
          sectionName={sectionName}
          workbook={workbook}
          sourceLineIds={instance.sourceLineIds}
          onSetSourceLines={onChangeSourceLines}
        />

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

          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button size="sm" variant="ghost" iconLeft="trash-2" onClick={onDelete}>
              {instance.isNew ? 'Discard' : 'Delete'} {instance.sectionId ? 'KPI' : 'sub-line'}
            </Button>
          </div>
        </div>
      </div>

      {isManual ? (
        <div>
          <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
            No source line mapped — enter actuals manually
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-5)', overflowX: 'auto', paddingBottom: 'var(--space-2)' }}>
            {workbook.periods.map((period, i) => (
              <div key={period.name} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: '0 0 auto', width: 90 }}>
                <span style={{ fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)' }}>{period.name}</span>
                <DriverValueInput
                  stored={manualValues[i] ?? null}
                  unit="raw"
                  onCommit={(value) => onChangeManualValue(i, value)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
