import { useState } from 'react';
import { Button } from '@basis/design-system';
import type { ParsedWorkbook, StatementLine } from '../../../data';
import { SourceLineChecklist } from './SourceLineChecklist';
import { ManualHistoricalsInput } from './ManualHistoricalsInput';
import { LineSettingsPanel, type LineSettingsSection } from '../../common/LineSettingsPanel';

interface InstanceMappingDetailProps {
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
  onClose: () => void;
}

const DEFAULT_OPEN_SECTIONS = ['mapping'];

/** Mapping mode's panel for a sub-line/KPI row — source mapping (or manual entry) only. Name,
 *  projection, debt-tranche properties and delete all live in Edit-schema mode's shared
 *  LineSettingsPanelContent instead (see SectionEditor.tsx) — this component's job is strictly
 *  the mapping act. A source mapping and manual entry are mutually exclusive; picking a source
 *  line always wins once one is set, matching every other line's "mapped value wins" rule. */
export function InstanceMappingDetail({
  line, sectionName, workbook, isKpi, sourceLineIds, manualHistoricals, onChangeSourceLines, onChangeManualHistoricals, onClose,
}: InstanceMappingDetailProps) {
  const [manualEntry, setManualEntry] = useState(sourceLineIds.length === 0 && manualHistoricals.some((v) => v !== null));
  const [openKeys, setOpenKeys] = useState<string[]>(DEFAULT_OPEN_SECTIONS);
  const toggleSection = (key: string) => setOpenKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const sections: LineSettingsSection[] = [
    {
      key: 'mapping',
      label: 'Source mapping',
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
            <Button size="sm" variant="ghost" onClick={() => setManualEntry((prev) => !prev)}>
              {manualEntry ? 'Map from the uploaded file instead' : 'Not in the uploaded file? Enter values manually'}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <LineSettingsPanel
      title={line.name || (isKpi ? 'Untitled KPI' : 'Untitled sub-line')}
      subtitle={isKpi ? 'KPI' : 'Sub-line'}
      icon="corner-down-right"
      onClose={onClose}
      openKeys={openKeys}
      onToggleSection={toggleSection}
      sections={sections}
    />
  );
}
