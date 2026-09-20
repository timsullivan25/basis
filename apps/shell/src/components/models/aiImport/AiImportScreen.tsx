import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Icon } from '@basis/design-system';
import type { StatementSection } from '../../../data';
import { analyzeWorkbook, planForSheets, type AnalysisStep, type WorkbookAnalysis } from '../../../lib/aiImport/analyzeWorkbook';
import { extractHistoricals } from '../../../lib/aiImport/extractHistoricals';
import { planNeedsConfirmation, type ExtractionPlan } from '../../../lib/aiImport/extractionPlan';
import { defaultPeriodKeys, periodOptions } from '../../../lib/aiImport/periodOptions';
import { getLlmProvider } from '../../../lib/aiImport/provider';
import { triageNeedsConfirmation } from '../../../lib/aiImport/triage';
import { writeBasisTemplate } from '../../../lib/aiImport/writeBasisTemplate';
import { ImportStepper } from '../ImportStepper';
import { DataStep, sectionKey } from './DataStep';
import type { RowRange } from './SheetViewer';
import { PreviewStep } from './PreviewStep';
import { SheetsStep } from './SheetsStep';
import { mutedText } from './styles';

const STEPS = ['Choose sheets', 'Choose data', 'Preview'];

const RUNNING_LABELS: Record<AnalysisStep, string> = {
  reading: 'Reading the workbook…',
  scoring: 'Scoring each sheet against the Basis statement schema…',
  triage: 'Deciding which sheets hold the financials…',
  planning: 'Planning the extraction…',
};

function templateFileName(original: string): string {
  return `${original.replace(/\.xlsx$/i, '')} (Basis Template).xlsx`;
}

interface AiImportScreenProps {
  /** The user's own upload — extraction reads it, and it stays the import's root file. */
  file: File;
  companyName: string;
  /** Statement schema whose line names and aliases score the sheets. */
  sections: StatementSection[];
  onCancel: () => void;
  /** Hands the generated Basis Template on to the normal mapping flow. */
  onDone: (templateFile: File) => void;
}

type Status = { kind: 'running'; step: AnalysisStep } | { kind: 'ready' } | { kind: 'error'; message: string };

/** The AI import as a full-screen, three-step flow (sheets → data → preview), like the mapping screen that follows it. Nothing is saved here. */
export function AiImportScreen({ file, companyName, sections, onCancel, onDone }: AiImportScreenProps) {
  const [status, setStatus] = useState<Status>({ kind: 'running', step: 'reading' });
  const [analysis, setAnalysis] = useState<WorkbookAnalysis | null>(null);
  const [step, setStep] = useState(1);
  const [plan, setPlan] = useState<ExtractionPlan | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [disabledSections, setDisabledSections] = useState<Set<string>>(new Set());
  const [replanning, setReplanning] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  /** Installs a fresh plan and resets everything derived from it (default periods, no excluded sections). */
  function applyPlan(next: ExtractionPlan | null, grids: WorkbookAnalysis['grids']) {
    setPlan(next);
    setDisabledSections(new Set());
    setSelectedPeriods(next ? defaultPeriodKeys(periodOptions(grids, next)) : new Set());
  }

  useEffect(() => {
    let cancelled = false;
    analyzeWorkbook(getLlmProvider(), file, sections, (s) => {
      if (!cancelled) setStatus({ kind: 'running', step: s });
    })
      .then((result) => {
        if (cancelled) return;
        setAnalysis(result);
        setSelectedSheets(result.triage.sheets.map((s) => s.name));
        applyPlan(result.plan, result.grids);
        setStatus({ kind: 'ready' });
      })
      .catch((err) => {
        console.error('[ai-import] analysis failed', err);
        if (!cancelled) setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'The import could not be analyzed.' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per upload
  }, [file, sections]);

  /** The plan minus whatever the user switched off. */
  const effectivePlan = useMemo<ExtractionPlan | null>(() => {
    if (!plan) return null;
    const sheets = plan.sheets
      .map((sheet, si) => ({ ...sheet, sections: sheet.sections.filter((_, ci) => !disabledSections.has(sectionKey(si, ci))) }))
      .filter((sheet) => sheet.sections.length > 0);
    return { ...plan, sheets };
  }, [plan, disabledSections]);

  const options = useMemo(() => (analysis && plan ? periodOptions(analysis.grids, plan) : []), [analysis, plan]);

  const extraction = useMemo(() => {
    if (!analysis || !effectivePlan) return { result: null, error: null };
    if (effectivePlan.sheets.length === 0) return { result: null, error: 'Every section is switched off.' };
    try {
      return { result: extractHistoricals(analysis.grids, effectivePlan, { keys: selectedPeriods }), error: null };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : 'Extraction failed.' };
    }
  }, [analysis, effectivePlan, selectedPeriods]);

  const lineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const line of extraction.result?.workbook.lines ?? []) counts[line.section] = (counts[line.section] ?? 0) + 1;
    return counts;
  }, [extraction]);

  const reasons: string[] = [];
  if (analysis && triageNeedsConfirmation(analysis.triage)) {
    reasons.push(analysis.triage.layout === 'none' ? 'No historical financials were found.' : `Sheet choice is ${analysis.triage.confidence} confidence.`);
  }
  if (plan && planNeedsConfirmation(plan.results)) {
    for (const r of plan.results) {
      if (r.confidence !== 'high') reasons.push(`Plan for "${r.plan.sheet}" is ${r.confidence} confidence.`);
      for (const q of r.openQuestions) reasons.push(`"${r.plan.sheet}": ${q}`);
    }
  }

  const planSheetNames = plan?.sheets.map((s) => s.sheet) ?? [];
  const selectionChanged = selectedSheets.slice().sort().join('|') !== planSheetNames.slice().sort().join('|');

  function setRange(sheetIdx: number, sectionIdx: number, range: RowRange) {
    setPlan((current) =>
      current && {
        ...current,
        sheets: current.sheets.map((sheet, si) =>
          si !== sheetIdx
            ? sheet
            : { ...sheet, sections: sheet.sections.map((sec, i) => (i === sectionIdx ? { ...sec, firstRow: range.first, lastRow: range.last } : sec)) },
        ),
      },
    );
  }

  async function goNext() {
    if (!analysis) return;
    if (step === 1) {
      if (selectionChanged) {
        setReplanning(true);
        setReplanError(null);
        try {
          applyPlan(await planForSheets(getLlmProvider(), analysis.grids, sections, selectedSheets), analysis.grids);
        } catch (err) {
          setReplanError(err instanceof Error ? err.message : 'Could not plan the selected sheets.');
          setReplanning(false);
          return;
        }
        setReplanning(false);
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  }

  async function buildTemplate(): Promise<File | null> {
    if (!extraction.result) return null;
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

  const ready = status.kind === 'ready' && analysis !== null;
  const canAdvance =
    ready &&
    !replanning &&
    (step === 1 ? selectedSheets.length > 0 : step === 2 ? Boolean(extraction.result) : Boolean(extraction.result));

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', background: 'var(--surface-app)' }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-8)', flexWrap: 'wrap',
          padding: 'var(--space-6) var(--gutter)', borderBottom: '1px solid var(--border-default)', background: 'var(--surface-card)',
        }}
      >
        <ImportStepper steps={STEPS} current={step} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-3) var(--space-5)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
          <Icon name="file-spreadsheet" size={16} color="var(--text-brand)" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{file.name}</span>
            <span style={{ fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)' }}>{companyName} · Extract with AI</span>
          </div>
        </div>
      </header>

      <main style={{ flex: '1 1 auto', overflow: 'auto', padding: 'var(--gutter)' }}>
        {status.kind === 'running' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-13) 0' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{RUNNING_LABELS[status.step]}</span>
            <span style={mutedText}>Nothing is saved until you continue to mapping.</span>
          </div>
        ) : status.kind === 'error' ? (
          <Alert tone="negative" title="Couldn't analyze this file">
            {status.message}
          </Alert>
        ) : analysis ? (
          <>
            {step === 1 ? (
              <SheetsStep
                analysis={analysis}
                selectedSheets={selectedSheets}
                onToggleSheet={(name, on) => setSelectedSheets((cur) => (on ? [...cur, name] : cur.filter((n) => n !== name)))}
                reasons={reasons}
                replanError={replanError}
              />
            ) : null}
            {step === 2 && plan ? (
              <DataStep
                grids={analysis.grids}
                plan={plan}
                options={options}
                selectedPeriods={selectedPeriods}
                onPeriodsChange={setSelectedPeriods}
                disabledSections={disabledSections}
                onToggleSection={(key, include) =>
                  setDisabledSections((cur) => {
                    const next = new Set(cur);
                    if (include) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                onSetRange={setRange}
                lineCounts={lineCounts}
                extractionError={extraction.error}
              />
            ) : null}
            {step === 3 ? <PreviewStep result={extraction.result} error={extraction.error} /> : null}
          </>
        ) : null}
      </main>

      <footer
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)',
          padding: 'var(--space-5) var(--gutter)', borderTop: '1px solid var(--border-default)', background: 'var(--surface-card)',
        }}
      >
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          {step > 1 ? (
            <Button variant="secondary" iconLeft="arrow-left" onClick={() => setStep(step - 1)} disabled={replanning}>
              Back
            </Button>
          ) : null}
          {step === 3 ? (
            <>
              <Button variant="secondary" iconLeft="download" onClick={() => void handleDownload()} disabled={!canAdvance}>
                Download template
              </Button>
              <Button variant="primary" onClick={() => void handleContinue()} disabled={!canAdvance} loading={building}>
                Continue to mapping
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => void goNext()} disabled={!canAdvance} loading={replanning}>
              Next
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
