import { useState } from 'react';
import { Button, Card, Icon, SegmentedControl, Select } from '@basis/design-system';
import { statementSchemaRepository, type StatementSchema } from '../../../data';
import { assignConceptLine, conceptSource, findSummaryLine, INPUT_CONCEPT_DEFAULTS, setConceptInput, type SummaryConcept } from '../../../lib/summaryLines';
import { formatPeriodValue } from '../mapping/mappingFormatting';
import { PercentInput } from './PercentInput';

const CONCEPT_LABELS: Record<SummaryConcept, string> = {
  revenue: 'Revenue', ebitda: 'EBITDA', netDebt: 'Net Debt', netLeverage: 'Net Leverage',
  interestCoverage: 'Interest Coverage', totalDebt: 'Total Debt', totalEquity: 'Total Equity',
  ebit: 'EBIT', da: 'D&A', capex: 'CapEx', nwc: 'Net Working Capital', taxRate: 'Effective Tax Rate',
  cash: 'Cash & Equivalents', fcf: 'Free Cash Flow',
};

const ADD_NEW_LINE = '__add_new_line__';

interface ConceptLinesCardProps {
  schema: StatementSchema;
  concepts: SummaryConcept[];
  onSchemaUpdated: (schema: StatementSchema) => void;
  onOpenStatementDefinitions: () => void;
}

/** Which statement line each concept an analysis reads resolves to — editable at any time, not
 *  just while something is missing, so a line can be re-pointed after the fact (e.g. CapEx moved
 *  to a different line). A concept with an input default (the tax rate) also gets a Linked/Input
 *  switch: Input is one number used flat across every period. Always expanded while anything is
 *  unresolved; otherwise collapsed behind an Edit toggle so it doesn't crowd the analysis itself. */
export function ConceptLinesCard({ schema, concepts, onSchemaUpdated, onOpenStatementDefinitions }: ConceptLinesCardProps) {
  const [editing, setEditing] = useState(false);
  const resolved = concepts.map((concept) => ({ concept, line: findSummaryLine(schema, concept), source: conceptSource(schema, concept) }));
  const anyMissing = resolved.some((r) => !r.source);
  const expanded = anyMissing || editing;

  const lineGroups = schema.sections
    .map((s) => ({ label: s.name, options: s.lines.map((l) => ({ value: l.id, label: l.name })) }))
    .filter((g) => g.options.length > 0);

  async function assign(concept: SummaryConcept, lineId: string) {
    onSchemaUpdated(await statementSchemaRepository.save(assignConceptLine(schema, concept, lineId)));
  }

  async function updateInput(concept: SummaryConcept, patch: Parameters<typeof setConceptInput>[2]) {
    onSchemaUpdated(await statementSchemaRepository.save(setConceptInput(schema, concept, patch)));
  }

  const sourceLabel = (r: (typeof resolved)[number]) =>
    r.source?.kind === 'input' ? `${CONCEPT_LABELS[r.concept]} ${formatPeriodValue(r.source.value, 'percentage')} (input)` : r.line!.name;

  return (
    <Card
      title={anyMissing ? 'Required lines' : 'Lines used'}
      icon="list-checks"
      padding="none"
      subtitle={expanded ? undefined : resolved.map(sourceLabel).join(' · ')}
      actions={
        anyMissing ? undefined : (
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Edit'}
          </Button>
        )
      }
    >
      {expanded ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {resolved.map(({ concept, line, source }) => (
            <div
              key={concept}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-5)',
                padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--border-default)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                <Icon
                  name={source ? 'check' : 'circle-alert'}
                  size={12}
                  color={source ? 'var(--status-positive-fg)' : 'var(--status-negative-fg)'}
                />
                {CONCEPT_LABELS[concept]}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                {INPUT_CONCEPT_DEFAULTS[concept] !== undefined ? (
                  <SegmentedControl
                    size="sm"
                    options={[{ value: 'linked', label: 'Linked' }, { value: 'input', label: 'Input' }]}
                    value={source?.kind === 'input' ? 'input' : 'linked'}
                    onChange={(mode) => void updateInput(concept, { mode: mode as 'linked' | 'input' })}
                  />
                ) : null}
                {source?.kind === 'input' ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-2)', width: 240 }}>
                    <PercentInput
                      key={source.value}
                      value={source.value}
                      onCommit={(value) => {
                        if (value !== null && value !== source.value) void updateInput(concept, { value });
                      }}
                    />
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>% every period</span>
                  </span>
                ) : (
                <Select
                  size="sm"
                  fullWidth={false}
                  style={{ width: 240 }}
                  value={line?.id ?? ''}
                  invalid={!line}
                  options={[
                    ...(line ? [] : [{ value: '', label: 'Select a line…' }]),
                    { value: ADD_NEW_LINE, label: 'Add a new line…' },
                  ]}
                  groups={lineGroups}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!value || value === line?.id) return;
                    if (value === ADD_NEW_LINE) onOpenStatementDefinitions();
                    else void assign(concept, value);
                  }}
                />
                )}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
