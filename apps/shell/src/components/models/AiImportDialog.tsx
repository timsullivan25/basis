import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Alert, Badge, Button, Checkbox, DataTable, Dialog, Input, SegmentedControl, Tag } from '@basis/design-system';
import type { StatementSection } from '../../data';
import { analyzeWorkbook, planForSheets, type AnalysisStep, type WorkbookAnalysis } from '../../lib/aiImport/analyzeWorkbook';
import { extractHistoricals, type Granularity } from '../../lib/aiImport/extractHistoricals';
import type { ExtractionPlan } from '../../lib/aiImport/extractionPlan';
import { planNeedsConfirmation } from '../../lib/aiImport/extractionPlan';
import { getLlmProvider } from '../../lib/aiImport/provider';
import { triageNeedsConfirmation } from '../../lib/aiImport/triage';
import { writeBasisTemplate } from '../../lib/aiImport/writeBasisTemplate';

const STEP_LABELS: Record<AnalysisStep, string> = {
  reading: 'Reading the workbook…',
  scoring: 'Scoring each sheet against the Basis statement schema…',
  triage: 'Deciding which sheets hold the financials…',
  planning: 'Planning the extraction…',
};

const sectionTitle: CSSProperties = {
  fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const mutedText: CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' };

function formatCell(value: number | null): string {
  return value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function templateFileName(original: string): string {
  return `${original.replace(/\.xlsx$/i, '')} (Basis Template).xlsx`;
}

interface AiImportDialogProps {
  open: boolean;
  /** The user's own upload — extraction reads it, and it stays the import's root file. */
  file: File | null;
  companyName: string;
  /** Statement schema whose line names and aliases score the sheets. */
  sections: StatementSection[];
  onClose: () => void;
  /** Hands the generated Basis Template on to the normal mapping flow. */
  onDone: (templateFile: File) => void;
}

type Status = { kind: 'running'; step: AnalysisStep } | { kind: 'ready' } | { kind: 'error'; message: string };

/** The review step of the AI import: what the model found, what it planned to copy, and a preview of the result — editable before it enters mapping. */
export function AiImportDialog({ open, file, companyName, sections, onClose, onDone }: AiImportDialogProps) {
  const [status, setStatus] = useState<Status>({ kind: 'running', step: 'reading' });
  const [analysis, setAnalysis] = useState<WorkbookAnalysis | null>(null);
  const [plan, setPlan] = useState<ExtractionPlan | null>(null);
  const [granularity, setGranularity] = useState<Granularity>('annual');
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [replanning, setReplanning] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    setStatus({ kind: 'running', step: 'reading' });
    setAnalysis(null);
    setPlan(null);
    setGranularity('annual');
    setReplanError(null);
    analyzeWorkbook(getLlmProvider(), file, sections, (step) => {
      if (!cancelled) setStatus({ kind: 'running', step });
    })
      .then((result) => {
        if (cancelled) return;
        setAnalysis(result);
        setPlan(result.plan);
        setSelectedSheets(result.triage.sheets.map((s) => s.name));
        setStatus({ kind: 'ready' });
      })
      .catch((err) => {
        if (!cancelled) setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'The import could not be analyzed.' });
      });
    return () => {
      cancelled = true;
    };
  }, [open, file, sections]);

  const extraction = useMemo(() => {
    if (!analysis || !plan) return null;
    try {
      return { result: extractHistoricals(analysis.grids, plan, granularity), error: null };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : 'Extraction failed.' };
    }
  }, [analysis, plan, granularity]);

  const previewRows = useMemo(() => {
    if (!extraction?.result) return [];
    const rows: Record<string, unknown>[] = [];
    let section = '';
    extraction.result.workbook.lines.forEach((line, i) => {
      if (line.section !== section) {
        section = line.section;
        rows.push({ __group: section, id: `group-${section}` });
      }
      const row: Record<string, unknown> = { id: `line-${i}`, name: line.name };
      line.values.forEach((v, p) => {
        row[`p${p}`] = v;
      });
      rows.push(row);
    });
    return rows;
  }, [extraction]);

  const previewColumns = useMemo(
    () => [
      { key: 'name', label: 'Line', emphasis: true, maxWidth: 260 },
      ...(extraction?.result?.workbook.periods ?? []).map((p, i) => ({
        key: `p${i}`,
        label: p.name,
        numeric: true,
        render: (v: number | null) => formatCell(v),
      })),
    ],
    [extraction],
  );

  function updateRange(sheetIdx: number, sectionIdx: number, key: 'firstRow' | 'lastRow', raw: string) {
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 1) return;
    setPlan((current) =>
      current && {
        ...current,
        sheets: current.sheets.map((sheet, si) =>
          si !== sheetIdx ? sheet : { ...sheet, sections: sheet.sections.map((sec, i) => (i === sectionIdx ? { ...sec, [key]: value } : sec)) },
        ),
      },
    );
  }

  async function handleReplan() {
    if (!analysis || selectedSheets.length === 0) return;
    setReplanning(true);
    setReplanError(null);
    try {
      setPlan(await planForSheets(getLlmProvider(), analysis.grids, sections, selectedSheets));
    } catch (err) {
      setReplanError(err instanceof Error ? err.message : 'Could not plan the selected sheets.');
    } finally {
      setReplanning(false);
    }
  }

  async function buildTemplate(): Promise<File | null> {
    if (!file || !extraction?.result) return null;
    const blob = await writeBasisTemplate(extraction.result.workbook);
    return new File([blob], templateFileName(file.name), { type: blob.type });
  }

  async function handleDownload() {
    const templateFile = await buildTemplate();
    if (!templateFile) return;
    const url = URL.createObjectURL(templateFile);
    const link = document.createElement('a');
    link.href = url;
    link.download = templateFile.name;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleContinue() {
    setBuilding(true);
    try {
      const templateFile = await buildTemplate();
      if (templateFile) onDone(templateFile);
    } finally {
      setBuilding(false);
    }
  }

  const reasons: string[] = [];
  if (analysis && triageNeedsConfirmation(analysis.triage)) {
    reasons.push(analysis.triage.layout === 'none' ? 'No historical financials were found.' : `Sheet choice is ${analysis.triage.confidence} confidence.`);
  }
  if (analysis && plan && planNeedsConfirmation(plan.results)) {
    for (const r of plan.results) {
      if (r.confidence !== 'high') reasons.push(`Plan for "${r.plan.sheet}" is ${r.confidence} confidence.`);
      for (const q of r.openQuestions) reasons.push(`"${r.plan.sheet}": ${q}`);
    }
  }
  const candidateSheets = analysis?.evidence.filter((e) => e.rowCount > 0) ?? [];
  const planSheetNames = plan?.sheets.map((s) => s.sheet) ?? [];
  const selectionChanged = selectedSheets.slice().sort().join('|') !== planSheetNames.slice().sort().join('|');
  const canContinue = status.kind === 'ready' && Boolean(extraction?.result) && !replanning;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Review extracted financials"
      subtitle={file ? `${companyName} · ${file.name}` : companyName}
      width={960}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" iconLeft="download" onClick={() => void handleDownload()} disabled={!canContinue}>
            Download template
          </Button>
          <Button variant="primary" onClick={() => void handleContinue()} disabled={!canContinue} loading={building}>
            Continue to mapping
          </Button>
        </>
      }
    >
      {status.kind === 'running' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-8) 0', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{STEP_LABELS[status.step]}</span>
          <span style={mutedText}>Nothing is saved until you continue to mapping.</span>
        </div>
      ) : status.kind === 'error' ? (
        <Alert tone="negative" title="Couldn't analyze this file">
          {status.message}
        </Alert>
      ) : analysis ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
          {reasons.length > 0 ? (
            <Alert tone="caution" title="Please check this before continuing">
              <ul style={{ margin: 0, paddingLeft: 'var(--space-6)' }}>
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="info" title="The model was confident about where the financials are">
              Skim the result below, then continue.
            </Alert>
          )}
          <span style={mutedText}>{analysis.triage.reasoning}</span>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <span style={sectionTitle}>Sheets to import</span>
            {candidateSheets.map((sheet) => {
              const alternative = analysis.triage.alternatives.find((a) => a.sheet === sheet.name);
              return (
                <div key={sheet.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                  <Checkbox
                    checked={selectedSheets.includes(sheet.name)}
                    onChange={(next) => setSelectedSheets((cur) => (next ? [...cur, sheet.name] : cur.filter((n) => n !== sheet.name)))}
                    label={sheet.name}
                    description={`${sheet.rowCount} rows · ${sheet.schemaMatches.distinctLines} Basis lines matched${alternative ? ` · ${alternative.note}` : ''}`}
                  />
                  {alternative ? <Badge tone="neutral" size="sm">Also considered</Badge> : null}
                </div>
              );
            })}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
              <Button size="sm" onClick={() => void handleReplan()} disabled={!selectionChanged || selectedSheets.length === 0} loading={replanning}>
                Re-plan with this selection
              </Button>
              {replanError ? <span style={{ ...mutedText, color: 'var(--text-negative)' }}>{replanError}</span> : null}
            </div>
          </section>

          {plan ? (
            <>
              <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <span style={sectionTitle}>Periods</span>
                <SegmentedControl
                  size="sm"
                  value={granularity}
                  onChange={(v) => setGranularity(v as Granularity)}
                  options={[
                    { value: 'annual', label: 'Annual' },
                    { value: 'lowest', label: 'Lowest available (quarters)' },
                  ]}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  {(extraction?.result?.workbook.periods ?? []).map((p) => (
                    <Tag key={p.name}>{p.name}</Tag>
                  ))}
                </div>
              </section>

              <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <span style={sectionTitle}>Where each section lives</span>
                {plan.sheets.map((sheet, sheetIdx) => (
                  <div key={sheet.sheet} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
                      {sheet.sheet} <span style={mutedText}>· labels in column {sheet.labelColumn}</span>
                    </span>
                    {sheet.sections.map((section, sectionIdx) => (
                      <div key={`${section.name}-${sectionIdx}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                        <span style={{ width: 200, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>{section.name}</span>
                        <span style={mutedText}>rows</span>
                        <Input size="sm" mono type="number" style={{ width: 84 }} selectOnFocus value={section.firstRow} onChange={(e) => updateRange(sheetIdx, sectionIdx, 'firstRow', e.target.value)} />
                        <span style={mutedText}>to</span>
                        <Input size="sm" mono type="number" style={{ width: 84 }} selectOnFocus value={section.lastRow} onChange={(e) => updateRange(sheetIdx, sectionIdx, 'lastRow', e.target.value)} />
                      </div>
                    ))}
                  </div>
                ))}
              </section>

              <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <span style={sectionTitle}>
                  Preview{extraction?.result ? ` · ${extraction.result.workbook.lines.length} lines` : ''}
                </span>
                {extraction?.error ? <Alert tone="negative" title="Nothing to extract">{extraction.error}</Alert> : null}
                {extraction?.result?.warnings.length ? (
                  <Alert tone="caution" title="Warnings">
                    <ul style={{ margin: 0, paddingLeft: 'var(--space-6)' }}>
                      {extraction.result.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}
                {previewRows.length > 0 ? (
                  <DataTable dense stickyHeader stickyFirstColumn rowKey="id" columns={previewColumns} rows={previewRows} maxHeight={340} />
                ) : null}
              </section>
            </>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
