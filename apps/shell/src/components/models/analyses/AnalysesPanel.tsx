import { Accordion, Card, Switch } from '@basis/design-system';
import { ANALYSIS_CATALOG } from '../../../data/analysisCatalog';
import type { AnalysisSettings, DcfInputs, LboCase, LboFinancingInputs, Model, RecoveryInputs, ScenarioKey, StatementSchema } from '../../../data';
import type { LineValues } from '../../../lib/computedCache';
import type { SeedLboCaseParams } from '../../../lib/lbo';
import { AnalysisErrorBoundary } from './AnalysisErrorBoundary';
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
  onUpdateLboCase: (patch: Partial<Pick<LboCase, 'schema' | 'leverageLinkedTrancheId'>>) => void;
  onUpdateLboFinancing: (scenarioId: ScenarioKey, patch: Partial<LboFinancingInputs>) => void;
  onRemoveLboCase: () => void;
  /** Which enabled analyses' sections are expanded — owned by ModelWorkspaceScreen so it survives
   *  this panel unmounting on a tab switch. `null` means "never touched": everything enabled is open. */
  openKeys: string[] | null;
  onOpenKeysChange: (keys: string[]) => void;
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
  onUpdateLboFinancing,
  onRemoveLboCase,
  openKeys: openKeysProp,
  onOpenKeysChange,
}: AnalysesPanelProps) {
  const enabledIds = analysisSettings?.enabledAnalysisIds ?? [];

  // Deliberately no effect re-deriving this from enabledAnalysisIds — that array is a fresh copy
  // on every settings save (any DCF/Recovery input edit), which used to re-open every section.
  // Newly-enabled analyses are opened by the toggle handler itself instead.
  const openKeys = openKeysProp ?? enabledIds;

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
        onUpdateLboFinancing={onUpdateLboFinancing}
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
            onOpenKeysChange(openKeys.includes(key) ? openKeys.filter((k) => k !== key) : [...openKeys, key])
          }
          items={ANALYSIS_CATALOG.filter((entry) => enabledIds.includes(entry.id)).map((entry) => ({
            key: entry.id,
            label: entry.name,
            icon: entry.icon,
            content: (
              <AnalysisErrorBoundary name={entry.name} resetKeys={[schema, model, evaluation, analysisSettings, activeScenarioId, lboCase]}>
                {panelPropsById[entry.id]}
              </AnalysisErrorBoundary>
            ),
          }))}
        />
      ) : null}
    </div>
  );
}
