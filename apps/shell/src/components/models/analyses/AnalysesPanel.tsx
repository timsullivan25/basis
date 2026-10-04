import { useEffect, useState } from 'react';
import { Accordion, Card, Switch } from '@basis/design-system';
import { ANALYSIS_CATALOG } from '../../../data/analysisCatalog';
import type { AnalysisSettings, DcfInputs, LboCase, Model, RecoveryInputs, ScenarioKey, StatementSchema } from '../../../data';
import type { LineValues } from '../../../lib/computedCache';
import type { SeedLboCaseParams } from '../../../lib/lbo';
import { DcfPanel } from './DcfPanel';
import { LboPanel } from './LboPanel';
import { RecoveryWaterfallPanel } from './RecoveryWaterfallPanel';

interface AnalysesPanelProps {
  schema: StatementSchema;
  model: Model;
  evaluation: LineValues;
  analysisSettings: AnalysisSettings | null;
  activeScenarioId: ScenarioKey;
  onToggleAnalysis: (analysisId: string, enabled: boolean) => void;
  onUpdateDcfInputs: (scenarioId: ScenarioKey, patch: Partial<DcfInputs>) => void;
  onUpdateRecoveryInputs: (scenarioId: ScenarioKey, patch: Partial<RecoveryInputs>) => void;
  onSchemaUpdated: (schema: StatementSchema) => void;
  onOpenStatementDefinitions: () => void;
  lboCase: LboCase | null;
  onCreateLboCase: (params: Omit<SeedLboCaseParams, 'baseSchema' | 'baseTimeline' | 'baseEvaluation'>) => void;
  onUpdateLboCase: (patch: Partial<Pick<LboCase, 'schema' | 'financing' | 'leverageLinkedTrancheId'>>) => void;
  onRemoveLboCase: () => void;
}

/** Always starts from the full catalog (today, just DCF) with an enable/disable toggle per entry
 *  — an analysis is selectable regardless of whether its required concepts resolve yet; each
 *  enabled analysis's own panel is what shows a resolution checklist for anything still missing. */
export function AnalysesPanel({
  schema,
  model,
  evaluation,
  analysisSettings,
  activeScenarioId,
  onToggleAnalysis,
  onUpdateDcfInputs,
  onUpdateRecoveryInputs,
  onSchemaUpdated,
  onOpenStatementDefinitions,
  lboCase,
  onCreateLboCase,
  onUpdateLboCase,
  onRemoveLboCase,
}: AnalysesPanelProps) {
  const enabledIds = analysisSettings?.enabledAnalysisIds ?? [];

  // Which enabled analyses' own Accordion sections are expanded — local UI state, not persisted
  // (nothing downstream needs to know). Starts with everything enabled today already open, and
  // newly-enabled analyses are added (never silently removed on disable, so re-enabling one
  // reopens it) — see the effect below.
  const [openKeys, setOpenKeys] = useState<string[]>(enabledIds);
  useEffect(() => {
    setOpenKeys((prev) => [...prev, ...enabledIds.filter((id) => !prev.includes(id))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisSettings?.enabledAnalysisIds]);

  const panelPropsById: Record<string, React.ReactNode> = {
    dcf: (
      <DcfPanel
        schema={schema}
        model={model}
        evaluation={evaluation}
        analysisSettings={analysisSettings}
        activeScenarioId={activeScenarioId}
        onUpdateDcfInputs={onUpdateDcfInputs}
        onSchemaUpdated={onSchemaUpdated}
        onOpenStatementDefinitions={onOpenStatementDefinitions}
      />
    ),
    recoveryWaterfall: (
      <RecoveryWaterfallPanel
        schema={schema}
        model={model}
        evaluation={evaluation}
        analysisSettings={analysisSettings}
        activeScenarioId={activeScenarioId}
        onUpdateRecoveryInputs={onUpdateRecoveryInputs}
        onSchemaUpdated={onSchemaUpdated}
        onOpenStatementDefinitions={onOpenStatementDefinitions}
      />
    ),
    lbo: (
      <LboPanel
        schema={schema}
        model={model}
        evaluation={evaluation}
        activeScenarioId={activeScenarioId}
        lboCase={lboCase}
        onCreateLboCase={onCreateLboCase}
        onUpdateLboCase={onUpdateLboCase}
        onRemoveLboCase={onRemoveLboCase}
        onSchemaUpdated={onSchemaUpdated}
        onOpenStatementDefinitions={onOpenStatementDefinitions}
      />
    ),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <Card title="Analyses" icon="calculator" padding="none">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {ANALYSIS_CATALOG.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-default)',
              }}
            >
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
                {entry.name}
              </span>
              <Switch
                size="sm"
                checked={enabledIds.includes(entry.id)}
                onChange={(next) => onToggleAnalysis(entry.id, next)}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* One Accordion section per ENABLED analysis — each section's own header (name + icon,
          same icon as its row above) is what makes clear which cards below it belong to which
          analysis, instead of every analysis's cards stacking flat with no boundary between
          them. Scales to however many analyses this catalog grows to: each is independently
          collapsible rather than all of them always fully expanded on screen at once. */}
      {enabledIds.length > 0 ? (
        <Accordion
          openKeys={openKeys}
          onToggle={(key) =>
            setOpenKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
          }
          items={ANALYSIS_CATALOG.filter((entry) => enabledIds.includes(entry.id)).map((entry) => ({
            key: entry.id,
            label: entry.name,
            icon: entry.icon,
            content: panelPropsById[entry.id],
          }))}
        />
      ) : null}
    </div>
  );
}
