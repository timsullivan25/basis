import { Button } from '@basis/design-system';
import type { ParsedWorkbook, StatementLine } from '../../../data';
import { SourceLineChecklist } from './SourceLineChecklist';
import { ManualHistoricalsInput } from './ManualHistoricalsInput';
import type { LineSettingsSection } from '../../common/LineSettingsPanel';

export interface InstanceMappingSectionsProps {
  /** The child (or KPI) line itself — a real StatementLine living in the draft schema, not a
   *  separate entity. */
  line: StatementLine;
  sectionName: string;
  workbook: ParsedWorkbook;
  /** True for a freestanding (KPI) row under an allowsFreeformLines section; false for a
   *  sub-line rolling up into a parentLineId. */
  isKpi: boolean;
  sourceLineIds: string[];
  manualHistoricals: (number | null)[];
  onChangeSourceLines: (sourceLineIds: string[]) => void;
  onChangeManualHistoricals: (values: (number | null)[]) => void;
  /** Whether the manual-entry form (vs. the source-line checklist) is showing — lifted to the
   *  caller (LineSettingsPanelContent) rather than owned here, since this is now a plain section
   *  builder, not a component with its own state. */
  manualEntry: boolean;
  onToggleManualEntry: () => void;
}

/** Builds a sub-line/KPI row's "Mapping" section — source mapping (or manual entry) only —
 *  spliced into the shared line-settings panel (LineSettingsPanelContent, see SectionEditor.tsx)
 *  right after Line properties, whenever mapping is turned on (ModelMappingScreen's
 *  showMappingSettings). Name, projection, debt-tranche properties and delete all live in the rest
 *  of that shared panel; this is strictly the mapping act. A source mapping and manual entry are
 *  mutually exclusive — picking a source line always wins once one is set, matching every other
 *  line's "mapped value wins" rule. */
export function buildInstanceMappingSections({
  line, sectionName, workbook, isKpi, sourceLineIds, manualHistoricals, onChangeSourceLines, onChangeManualHistoricals,
  manualEntry, onToggleManualEntry,
}: InstanceMappingSectionsProps): LineSettingsSection[] {
  return [
    {
      key: 'mapping',
      label: 'Mapping',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {manualEntry ? (
            <ManualHistoricalsInput workbook={workbook} values={manualHistoricals} onChange={onChangeManualHistoricals} />
          ) : (
            <SourceLineChecklist
              title={`Map ${line.name.trim() || (isKpi ? 'new KPI' : 'new sub-line')} from`}
              sectionName={sectionName}
              workbook={workbook}
              sourceLineIds={sourceLineIds}
              onSetSourceLines={onChangeSourceLines}
            />
          )}
          {sourceLineIds.length === 0 ? (
            <Button size="sm" variant="ghost" onClick={onToggleManualEntry}>
              {manualEntry ? 'Map from the uploaded file instead' : 'Not in the uploaded file? Enter values manually'}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
}
