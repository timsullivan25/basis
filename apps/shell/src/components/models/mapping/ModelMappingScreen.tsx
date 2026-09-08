import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, Dialog, Icon, Input, Tabs, Toast } from '@basis/design-system';
import {
  modelImportRepository,
  type Company,
  type LineMapping,
  type ModelImport,
  type ModelTemplateType,
  type ParsedWorkbook,
  type StatementLine,
  type StatementSchema,
} from '../../../data';
import { parseBasisTemplate, TemplateParseError } from '../../../lib/parseBasisTemplate';
import { matchStatementLines } from '../../../lib/matchStatementLines';
import { getLineRowStyle, getRequiredMeta } from '../../statements/statementFormatting';
import { ImportedLinesDialog } from './ImportedLinesDialog';
import { MappedLinesDialog } from './MappedLinesDialog';
import { MappingRowDetail } from './MappingRowDetail';
import { formatPeriodValue, isLowConfidence, isMissingRequired, needsReview, MATCH_METHOD_META } from './mappingFormatting';

const STEPS = ['Upload model', 'Map line items', 'Save'];

function computeTargetValue(mapping: LineMapping | undefined, workbook: ParsedWorkbook, periodIndex: number): number | null {
  if (!mapping || mapping.sourceLineIds.length === 0) return null;
  let sum = 0;
  let any = false;
  for (const id of mapping.sourceLineIds) {
    const value = workbook.lines.find((line) => line.id === id)?.values[periodIndex];
    if (value !== null && value !== undefined) {
      sum += value;
      any = true;
    }
  }
  return any ? sum : null;
}

interface ModelMappingScreenProps {
  company: Company;
  statementSchema: StatementSchema;
  /** Editing an already-saved model — Save updates its mapping in place. */
  modelImport?: ModelImport;
  /** A freshly-picked, not-yet-saved file — Save creates the model and its mapping together. */
  draft?: { templateType: ModelTemplateType; file: File; statementSchemaId: string };
  onCancel: () => void;
  onSaved: (updated: ModelImport) => void;
}

export function ModelMappingScreen({ company, statementSchema, modelImport, draft, onCancel, onSaved }: ModelMappingScreenProps) {
  const file = modelImport?.file ?? draft?.file;
  const fileName = modelImport?.fileName ?? draft?.file.name ?? '';
  if (!file) throw new Error('ModelMappingScreen requires either modelImport or draft.');

  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, LineMapping>>({});
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [importedLinesOpen, setImportedLinesOpen] = useState(false);
  const [mappedLinesOpen, setMappedLinesOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await parseBasisTemplate(file);
        if (cancelled) return;
        setWorkbook(parsed);
        if (modelImport?.mapping) {
          setMapping(Object.fromEntries(modelImport.mapping.map((m) => [m.targetLineId, m])));
        } else {
          setMapping(matchStatementLines(statementSchema.sections, parsed.lines));
        }
      } catch (err) {
        if (!cancelled) setParseError(err instanceof TemplateParseError ? err.message : 'Could not parse the uploaded file.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelImport?.id, draft?.file]);

  const allLines = useMemo(
    () => statementSchema.sections.flatMap((section) => section.lines.map((line) => ({ line, section }))),
    [statementSchema],
  );
  const mappableLines = useMemo(() => allLines.filter(({ line }) => !line.formula.trim()), [allLines]);
  const mappedCount = mappableLines.filter(({ line }) => (mapping[line.id]?.sourceLineIds.length ?? 0) > 0).length;
  const blockers = mappableLines.filter(({ line }) => isMissingRequired(line, mapping[line.id]));
  const reviewLines = mappableLines.filter(({ line }) => needsReview(line, mapping[line.id]));

  function updateMapping(targetLineId: string, patch: Partial<LineMapping>) {
    setMapping((prev) => ({ ...prev, [targetLineId]: { ...prev[targetLineId], ...patch } }));
  }

  function setSourceLines(target: StatementLine, sourceLineIds: string[]) {
    const previous = mapping[target.id];
    updateMapping(target.id, {
      sourceLineIds,
      method: sourceLineIds.length ? 'manual' : 'none',
      confidence: sourceLineIds.length ? 1 : 0,
      approved: false,
      note: sourceLineIds.length
        ? `Set manually. Previous: ${previous?.sourceLineIds.length ? previous.method : 'unmapped'}.`
        : 'Cleared manually.',
    });
  }

  async function handleSave() {
    if (blockers.length > 0) return;
    setSaving(true);
    try {
      const updated = modelImport
        ? await modelImportRepository.saveMapping(modelImport.id, Object.values(mapping))
        : await modelImportRepository.create({
            companyId: company.id,
            templateType: draft!.templateType,
            statementSchemaId: draft!.statementSchemaId,
            file: draft!.file,
            mapping: Object.values(mapping),
          });
      setSavedToast(true);
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  }

  if (parseError) {
    return (
      <Alert tone="negative" title="Couldn't read this file">
        {parseError}
        <div style={{ marginTop: 'var(--space-5)' }}>
          <Button size="sm" onClick={onCancel}>
            Back to financials
          </Button>
        </div>
      </Alert>
    );
  }

  if (!workbook) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Parsing {fileName}…</span>;
  }
  const wb = workbook;

  const query = search.trim().toLowerCase();
  function passes(line: StatementLine): boolean {
    if (onlyReview && !needsReview(line, mapping[line.id])) return false;
    if (query) {
      const sourceNames = (mapping[line.id]?.sourceLineIds ?? [])
        .map((id) => wb.lines.find((source) => source.id === id)?.name ?? '')
        .join(' ');
      if (!`${line.name} ${sourceNames}`.toLowerCase().includes(query)) return false;
    }
    return true;
  }

  const rows: Array<{ id: string; __group?: string; line?: StatementLine; sectionName?: string }> = [];
  statementSchema.sections.forEach((section) => {
    if (tab !== 'all' && tab !== section.id) return;
    const visible = section.lines.filter(passes);
    if (!visible.length) return;
    rows.push({ id: `group-${section.id}`, __group: section.name });
    visible.forEach((line) => rows.push({ id: line.id, line, sectionName: section.name }));
  });

  const columns = [
    {
      key: 'expand',
      label: '',
      width: 24,
      render: (_: unknown, row: { line?: StatementLine }) =>
        row.line && !row.line.formula.trim() ? (
          <Icon name={expandedLineId === row.line.id ? 'chevron-down' : 'chevron-right'} size={12} color="var(--text-tertiary)" />
        ) : null,
    },
    {
      key: 'target',
      label: 'Target line',
      width: 220,
      render: (_: unknown, row: { line?: StatementLine }) => {
        if (!row.line) return null;
        const m = mapping[row.line.id];
        const missing = isMissingRequired(row.line, m);
        const low = isLowConfidence(m);
        const dot = missing ? 'var(--red-600)' : low ? 'var(--violet-600)' : null;
        const rowLineStyle = getLineRowStyle(row.line);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
            <span
              title={missing ? 'Missing required line' : low ? 'Low confidence match' : undefined}
              style={{ width: 6, height: 6, borderRadius: '50%', flex: '0 0 auto', background: dot ?? 'transparent' }}
            />
            <span
              style={{
                fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', fontWeight: 'var(--weight-medium)',
                color: 'var(--text-primary)', ...rowLineStyle, background: undefined, borderTop: undefined,
              }}
            >
              {row.line.name}
            </span>
            {row.line.formula.trim() ? <Icon name="function-square" size={11} color="var(--text-tertiary)" /> : null}
          </div>
        );
      },
    },
    {
      key: 'source',
      label: 'Source line',
      width: 280,
      render: (_: unknown, row: { line?: StatementLine }) => {
        if (!row.line) return null;
        if (row.line.formula.trim()) {
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Calculated · {row.line.formula}
            </span>
          );
        }
        const m = mapping[row.line.id];
        const empty = !m || m.sourceLineIds.length === 0;
        const summary = empty
          ? 'Not mapped'
          : m.sourceLineIds.map((id) => workbook.lines.find((source) => source.id === id)?.name).join('  +  ');
        return (
          <span style={{ fontSize: 'var(--text-xs)', color: empty ? 'var(--text-caution)' : 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {summary}
            {m && m.sourceLineIds.length > 1 ? (
              <span style={{ marginLeft: 'var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)' }}>
                {m.sourceLineIds.length} lines
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: 110,
      render: (_: unknown, row: { line?: StatementLine }) => {
        if (!row.line) return null;
        const meta = getRequiredMeta(row.line);
        return (
          <Badge tone={meta.tone} size="sm">
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: 'match',
      label: 'Match',
      width: 130,
      render: (_: unknown, row: { line?: StatementLine }) => {
        if (!row.line) return null;
        if (row.line.formula.trim()) {
          return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Derived</span>;
        }
        const m = mapping[row.line.id];
        if (!m) return null;
        const meta = MATCH_METHOD_META[m.method];
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Badge tone={meta.tone} size="sm" icon={meta.icon}>
              {meta.label}
            </Badge>
            {m.method !== 'none' && m.method !== 'manual' ? (
              <span style={{ fontSize: 'var(--text-3xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'var(--numeric-tabular)', color: isLowConfidence(m) ? 'var(--text-caution)' : 'var(--text-tertiary)' }}>
                {m.confidence.toFixed(2)}
              </span>
            ) : null}
          </div>
        );
      },
    },
    ...workbook.periods.map((period, i) => ({
      key: `p${i}`,
      label: period.name,
      numeric: true,
      width: 96,
      render: (_: unknown, row: { line?: StatementLine }) => {
        if (!row.line) return null;
        if (row.line.formula.trim()) {
          return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-disabled)' }}>—</span>;
        }
        const value = computeTargetValue(mapping[row.line.id], workbook, i);
        return (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)', color: value === null ? 'var(--text-disabled)' : 'var(--text-body)' }}>
            {formatPeriodValue(value)}
          </span>
        );
      },
    })),
  ];

  const tabs = [
    { value: 'all', label: 'All' },
    ...statementSchema.sections.map((section) => {
      const issues = section.lines.filter((line) => needsReview(line, mapping[line.id])).length;
      return { value: section.id, label: section.name, count: issues > 0 ? issues : undefined };
    }),
  ];

  const statusText = blockers.length
    ? `${blockers.length} required line${blockers.length > 1 ? 's' : ''} unmapped: ${blockers.map((b) => b.line.name).join(', ')}`
    : reviewLines.length
      ? `${reviewLines.length} line${reviewLines.length > 1 ? 's' : ''} need review`
      : `All target lines mapped and above threshold. Ready to save ${workbook.periods.length} periods.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
        <ol style={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 0, margin: 0, padding: 0 }}>
          {STEPS.map((label, i) => {
            const stepNum = i + 1;
            const state = stepNum < 2 ? 'done' : stepNum === 2 ? 'current' : 'upcoming';
            return (
              <li key={label} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 ? <span style={{ width: 28, height: 1, background: 'var(--border-default)', margin: '0 var(--space-5)' }} /> : null}
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', opacity: state === 'upcoming' ? 0.55 : 1 }}>
                  <span
                    style={{
                      width: 18, height: 18, flex: '0 0 auto', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--font-mono)', fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)',
                      background: state === 'done' ? 'var(--status-positive-bg)' : state === 'current' ? 'var(--action-primary-bg)' : 'var(--surface-sunken)',
                      color: state === 'done' ? 'var(--status-positive-fg)' : state === 'current' ? 'var(--action-primary-fg)' : 'var(--text-secondary)',
                    }}
                  >
                    {stepNum}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: state === 'current' ? 'var(--weight-semibold)' : 'var(--weight-medium)', color: state === 'current' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {label}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-3) var(--space-5)', background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
          <Icon name="file-spreadsheet" size={16} color="var(--text-brand)" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{fileName}</span>
            <span style={{ fontSize: 'var(--text-3xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
              {workbook.periods.length} periods · {workbook.lines.length} lines
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-6)' }}>
        <Card padding="sm">
          <MetricRow label="Lines imported" value={String(workbook.lines.length)} icon="table-2" onDrill={() => setImportedLinesOpen(true)} />
        </Card>
        <Card padding="sm">
          <MetricRow
            label="Mapped"
            value={`${mappedCount} / ${mappableLines.length}`}
            icon="git-merge"
            onDrill={() => setMappedLinesOpen(true)}
          />
        </Card>
        <Card padding="sm">
          <MetricRow
            label="Issues flagged"
            value={String(reviewLines.length)}
            icon="alert-triangle"
            tone={reviewLines.length ? 'caution' : undefined}
            onDrill={reviewLines.length ? () => setOnlyReview(true) : undefined}
          />
        </Card>
      </div>

      {blockers.length > 0 || reviewLines.length > 0 ? (
        <Alert tone="caution" compact>
          {statusText}
        </Alert>
      ) : null}

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        size="sm"
        actions={
          <>
            <Input size="sm" iconLeft="search" placeholder="Find target or source line" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
            <Button size="sm" iconLeft="filter" selected={onlyReview} onClick={() => setOnlyReview(!onlyReview)}>
              Needs review · {reviewLines.length}
            </Button>
          </>
        }
      />

      <Card padding="none" icon="git-merge" title="Line item mapping">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          rowStyle={(row: { line?: StatementLine }) => (row.line ? getLineRowStyle(row.line) : {})}
          dense
          stickyHeader
          maxHeight="calc(100vh - 420px)"
          expandedKey={expandedLineId}
          onRowClick={(row) => {
            if (row.line && !row.line.formula.trim()) setExpandedLineId(expandedLineId === row.line.id ? null : row.line.id);
          }}
          renderDetail={(row: { line?: StatementLine; sectionName?: string }) =>
            row.line ? (
              <MappingRowDetail
                target={row.line}
                sectionName={row.sectionName ?? ''}
                mapping={mapping[row.line.id]}
                workbook={workbook}
                onSetSourceLines={(ids) => setSourceLines(row.line as StatementLine, ids)}
                onApprove={() => updateMapping((row.line as StatementLine).id, { approved: true })}
              />
            ) : null
          }
        />
      </Card>

      <div style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-8)', padding: 'var(--space-5) 0', background: 'var(--surface-app)', borderTop: '1px solid var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
          <Icon name={blockers.length ? 'alert-triangle' : reviewLines.length ? 'info' : 'check-circle-2'} size={14} color={blockers.length ? 'var(--text-caution)' : reviewLines.length ? 'var(--text-secondary)' : 'var(--text-positive)'} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{statusText}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <Button onClick={() => setCancelConfirmOpen(true)}>Cancel import</Button>
          <Button variant="primary" iconLeft="check" disabled={blockers.length > 0} loading={saving} onClick={handleSave}>
            Save mapping
          </Button>
        </div>
      </div>

      <ImportedLinesDialog open={importedLinesOpen} workbook={workbook} onClose={() => setImportedLinesOpen(false)} />
      <MappedLinesDialog open={mappedLinesOpen} statementSchema={statementSchema} mapping={mapping} onClose={() => setMappedLinesOpen(false)} />

      <Dialog
        open={cancelConfirmOpen}
        onClose={() => setCancelConfirmOpen(false)}
        icon="alert-triangle"
        title="Discard this import?"
        subtitle={company.name}
        footer={
          <>
            <Button onClick={() => setCancelConfirmOpen(false)}>Keep editing</Button>
            <Button variant="danger" iconLeft="trash-2" onClick={onCancel}>
              Discard import
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          The parsed file and any mapping changes will be discarded. Nothing is written until you save.
        </p>
      </Dialog>

      {savedToast ? (
        <div style={{ position: 'fixed', right: 'var(--space-8)', bottom: 'var(--space-8)', zIndex: 200 }}>
          <Toast tone="positive" title="Import saved" onDismiss={() => setSavedToast(false)}>
            {mappedCount} mapped lines · {workbook.periods.length} periods saved to {company.name}
          </Toast>
        </div>
      ) : null}
    </div>
  );
}

function MetricRow({ label, value, icon, tone, onDrill }: { label: string; value: string; icon: string; tone?: 'caution'; onDrill?: () => void }) {
  return (
    <div
      role={onDrill ? 'button' : undefined}
      tabIndex={onDrill ? 0 : undefined}
      onClick={onDrill}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: onDrill ? 'pointer' : 'default' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', color: tone === 'caution' ? 'var(--text-caution)' : 'var(--text-primary)' }}>
          {value}
        </span>
      </div>
      <Icon name={icon} size={18} color={tone === 'caution' ? 'var(--text-caution)' : 'var(--text-tertiary)'} />
    </div>
  );
}
