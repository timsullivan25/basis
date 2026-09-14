import { useState } from 'react';
import { Button, Input } from '@basis/design-system';
import type { DebtTrancheProperties, ParsedWorkbook, StatementLine } from '../../../data';
import { SourceLineChecklist } from './SourceLineChecklist';
import { ManualHistoricalsInput } from './ManualHistoricalsInput';
import { ProjectionMethodEditor, type SchemaLineGroup } from '../instances/projectionMethod';
import type { ChildProjectionSelection } from '../../../lib/statementLineChildren';
import { DebtTranchePropertiesEditor } from '../instances/DebtTranchePropertiesEditor';
import { LineSettingsPanel, type LineSettingsSection } from '../../common/LineSettingsPanel';

interface InstanceRowDetailProps {
  /** The child (or KPI) line itself — a real StatementLine living in the draft schema, not a
   *  separate entity. */
  line: StatementLine;
  sectionName: string;
  workbook: ParsedWorkbook;
  schemaLineGroups: SchemaLineGroup[];
  /** This line's own driver's basisLineId, resolved by the caller from the draft schema's
   *  drivers — StatementLine.projection itself never carries one. */
  basisLineId: string | undefined;
  /** True for a freestanding (KPI) row under an allowsFreeformLines section; false for a
   *  sub-line rolling up into a parentLineId. */
  isKpi: boolean;
  /** This line's effective kind (own, or inherited from its parent) — see
   *  StatementLine.lineKind's own doc comment. Shows the debt-properties panel when 'debt'. */
  effectiveKind: 'debt' | undefined;
  sourceLineIds: string[];
  manualHistoricals: (number | null)[];
  onChangeName: (name: string) => void;
  onChangeSourceLines: (sourceLineIds: string[]) => void;
  onChangeManualHistoricals: (values: (number | null)[]) => void;
  onChangeProjection: (selection: ChildProjectionSelection) => void;
  onChangeDebtProperties: (patch: Partial<DebtTrancheProperties>) => void;
  onDelete: () => void;
  onClose: () => void;
}

const DEFAULT_OPEN_SECTIONS = ['mapping', 'name', 'debt'];

/** The full editor for one child line's row — name, source mapping, and projection method/basis
 *  (or, for a debt-kind line, its tranche properties instead of a projection picker), all in one
 *  place. A child line is now an ordinary StatementLine living directly in the model's own draft
 *  schema (see lib/statementLineChildren.ts) — this component just edits whichever fields belong
 *  to mapping-time authoring, the same way it always has. A line with no source mapping can have
 *  its historicals typed in directly instead (ManualHistoricalsInput) — a source mapping and
 *  manual entry are mutually exclusive; picking a source line always wins once one is set,
 *  matching every other line's "mapped value wins" rule. */
export function InstanceRowDetail({
  line, sectionName, workbook, schemaLineGroups, basisLineId, isKpi, effectiveKind, sourceLineIds, manualHistoricals,
  onChangeName, onChangeSourceLines, onChangeManualHistoricals, onChangeProjection, onChangeDebtProperties, onDelete, onClose,
}: InstanceRowDetailProps) {
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
    {
      key: 'name',
      label: 'Name & projection',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
              {isKpi ? 'KPI' : 'Sub-line'} name
            </div>
            <Input
              size="sm"
              autoFocus={!line.name}
              value={line.name}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder={isKpi ? 'e.g. Monthly Active Users' : 'e.g. Segment A'}
            />
          </div>

          {effectiveKind === 'debt' ? (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              This tranche's projected balance doesn't use a generic projection method — it's
              driven entirely by the Debt Schedule's own roll-forward (Beginning − Amortization −
              Repayment + Borrowing), based on the tranche details below. See the Debt Schedule
              section for the full breakdown.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                Projection method
              </div>
              <ProjectionMethodEditor
                projection={line.projection}
                basisLineId={basisLineId}
                excludeLineId={line.id}
                schemaLineGroups={schemaLineGroups}
                onChange={onChangeProjection}
              />
            </div>
          )}
        </div>
      ),
    },
  ];

  if (effectiveKind === 'debt') {
    sections.push({
      key: 'debt',
      label: 'Debt tranche',
      content: <DebtTranchePropertiesEditor instance={line.debtProperties ?? {}} onChange={onChangeDebtProperties} />,
    });
  }

  return (
    <LineSettingsPanel
      title={line.name || (isKpi ? 'Untitled KPI' : 'Untitled sub-line')}
      subtitle={isKpi ? 'KPI' : 'Sub-line'}
      icon="corner-down-right"
      onClose={onClose}
      openKeys={openKeys}
      onToggleSection={toggleSection}
      sections={sections}
      footer={
        <Button size="sm" variant="ghost" iconLeft="trash-2" onClick={onDelete}>
          Delete {isKpi ? 'KPI' : 'sub-line'}
        </Button>
      }
    />
  );
}
