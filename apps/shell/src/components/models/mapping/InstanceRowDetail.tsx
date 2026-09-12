import { Button, Input } from '@basis/design-system';
import type { LineInstance, ParsedWorkbook } from '../../../data';
import { SourceLineChecklist } from './SourceLineChecklist';
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
  schemaLineGroups: SchemaLineGroup[];
  /** Every other instance in this model, for the sibling-instance-basis group in the method
   *  picker — see ProjectionMethodEditor. */
  allInstances: LineInstance[];
  lineNameById: Map<string, string>;
  onChangeName: (name: string) => void;
  onChangeSourceLines: (sourceLineIds: string[]) => void;
  onChangeProjection: (selection: InstanceProjectionSelection) => void;
  onDelete: () => void;
}

/** The full editor for one sub-line/KPI instance — name, source mapping, and projection
 *  method/basis, all in one place. Used for both a brand-new instance (added via the "+ Add
 *  sub-line/KPI" row, held as a draft until Save) and an already-persisted one being revisited —
 *  mapping is the sole place instance structure is edited now; the model workspace's Drivers card
 *  only fills in driver values (see the Phase 9 revision plan). An instance with no source line
 *  mapped simply has no historical values and projects forward from nothing — there's
 *  deliberately no manual-entry escape hatch here (that's what mapping a source line is for). */
export function InstanceRowDetail({
  instance, sectionName, workbook, schemaLineGroups, allInstances, lineNameById,
  onChangeName, onChangeSourceLines, onChangeProjection, onDelete,
}: InstanceRowDetailProps) {
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
    </div>
  );
}
