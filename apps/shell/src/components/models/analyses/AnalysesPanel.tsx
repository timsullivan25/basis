import { Card, Switch } from '@basis/design-system';
import { ANALYSIS_CATALOG } from '../../../data/analysisCatalog';
import type { AnalysisSettings, DcfInputs, LboCase, Model, ScenarioKey, StatementSchema } from '../../../data';
import type { LineValues } from '../../../lib/computedCache';
import type { SeedLboCaseParams } from '../../../lib/lbo';
import { DcfPanel } from './DcfPanel';
import { LboPanel } from './LboPanel';

interface AnalysesPanelProps {
  schema: StatementSchema;
  model: Model;
  evaluation: LineValues;
  analysisSettings: AnalysisSettings | null;
  activeScenarioId: ScenarioKey;
  onToggleAnalysis: (analysisId: string, enabled: boolean) => void;
  onUpdateDcfInputs: (scenarioId: ScenarioKey, patch: Partial<DcfInputs>) => void;
  onSchemaUpdated: (schema: StatementSchema) => void;
  onOpenStatementDefinitions: () => void;
  lboCase: LboCase | null;
  onCreateLboCase: (params: Omit<SeedLboCaseParams, 'baseSchema' | 'baseTimeline' | 'baseEvaluation'>) => void;
  onUpdateLboCase: (patch: Partial<Pick<LboCase, 'schema' | 'historicals' | 'driverValues' | 'financing'>>) => void;
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
  onSchemaUpdated,
  onOpenStatementDefinitions,
  lboCase,
  onCreateLboCase,
  onUpdateLboCase,
  onRemoveLboCase,
}: AnalysesPanelProps) {
  const enabledIds = analysisSettings?.enabledAnalysisIds ?? [];

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

      {enabledIds.includes('dcf') ? (
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
      ) : null}

      {enabledIds.includes('lbo') ? (
        <LboPanel
          schema={schema}
          model={model}
          lboCase={lboCase}
          onCreateLboCase={onCreateLboCase}
          onUpdateLboCase={onUpdateLboCase}
          onRemoveLboCase={onRemoveLboCase}
          onSchemaUpdated={onSchemaUpdated}
          onOpenStatementDefinitions={onOpenStatementDefinitions}
        />
      ) : null}
    </div>
  );
}
