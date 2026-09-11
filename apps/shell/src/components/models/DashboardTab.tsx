import { useEffect, useState } from 'react';
import { Button, Icon } from '@basis/design-system';
import {
  computedResultRepository,
  lineInstanceRepository,
  modelRepository,
  statementSchemaRepository,
  type Company,
  type LineInstance,
  type Model,
  type StatementSchema,
} from '../../data';
import {
  buildComputedResult,
  computeVersionStamp,
  materializeEvaluation,
  toLineValues,
  versionStampMatches,
  type LineValues,
} from '../../lib/computedCache';
import { applyDynamicInstances } from '../../lib/engine/withDynamicInstances';
import { SummaryPanel } from './SummaryPanel';

interface DashboardTabProps {
  company: Company;
  /** Navigates to the model workspace — see AppShell. */
  onOpenWorkspace: () => void;
  /** Switches CompanyDetailScreen's own tab state to Financials — where mapping a file actually
   *  happens; this tab never duplicates that flow. */
  onGoToFinancials: () => void;
}

/** Read-through cache lookup: a version-stamp hit skips the engine entirely (no schema-line
 *  traversal beyond what's needed for display, no evaluateModel call) — the concrete payoff of
 *  Slice 1's cache for a screen that, unlike the workspace, doesn't already have an evaluation
 *  sitting in scope. A miss (first-ever view, or the version stamp moved on) computes live once
 *  and writes the fresh result back, same shape Slice 3's write-through already produces. */
async function readOrComputeResult(model: Model, schema: StatementSchema, instances: LineInstance[]): Promise<LineValues> {
  const cached = await computedResultRepository.get(model.id, 'base');
  if (cached && versionStampMatches(cached.versionStamp, model, null, schema)) {
    return toLineValues(cached);
  }
  const { schema: instancedSchema, evaluation } = applyDynamicInstances(schema, model, instances);
  const materialized = materializeEvaluation(instancedSchema, model, evaluation);
  const versionStamp = computeVersionStamp(model, null, schema);
  const built = buildComputedResult(model.id, 'base', versionStamp, materialized);
  await computedResultRepository.set(built);
  return toLineValues(built);
}

export function DashboardTab({ company, onOpenWorkspace, onGoToFinancials }: DashboardTabProps) {
  const [model, setModel] = useState<Model | null | undefined>(undefined);
  const [schema, setSchema] = useState<StatementSchema | null>(null);
  const [result, setResult] = useState<LineValues | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existingModel = await modelRepository.getForCompany(company.id);
      if (cancelled) return;
      setModel(existingModel ?? null);
      if (!existingModel) return;

      const existingSchema = await statementSchemaRepository.get(existingModel.statementSchemaId);
      if (cancelled) return;
      setSchema(existingSchema ?? null);
      if (!existingSchema) return;

      const existingInstances = await lineInstanceRepository.list(existingModel.id);
      if (cancelled) return;
      const lineValues = await readOrComputeResult(existingModel, existingSchema, existingInstances);
      if (!cancelled) setResult(lineValues);
    })();
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  if (model === undefined) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  if (!model || !schema) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-5)', padding: 'var(--space-11) 0' }}>
        <Icon name="bar-chart-3" size={22} color="var(--text-tertiary)" />
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          No model yet — map a file under Financials to see a summary here.
        </span>
        <Button variant="link" onClick={onGoToFinancials}>
          Go to Financials
        </Button>
      </div>
    );
  }

  if (!result) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  return <SummaryPanel schema={schema} model={model} result={result} onOpenWorkspace={onOpenWorkspace} />;
}
