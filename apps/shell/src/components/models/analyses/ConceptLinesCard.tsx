import { useState } from 'react';
import { Button, Card, Icon, Select } from '@basis/design-system';
import { statementSchemaRepository, type StatementSchema } from '../../../data';
import { assignConceptLine, findSummaryLine, type SummaryConcept } from '../../../lib/summaryLines';

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
 *  to a different line). Always expanded while anything is unresolved; otherwise collapsed behind
 *  an Edit toggle so it doesn't crowd the analysis itself. */
export function ConceptLinesCard({ schema, concepts, onSchemaUpdated, onOpenStatementDefinitions }: ConceptLinesCardProps) {
  const [editing, setEditing] = useState(false);
  const resolved = concepts.map((concept) => ({ concept, line: findSummaryLine(schema, concept) }));
  const anyMissing = resolved.some((r) => !r.line);
  const expanded = anyMissing || editing;

  const lineGroups = schema.sections
    .map((s) => ({ label: s.name, options: s.lines.map((l) => ({ value: l.id, label: l.name })) }))
    .filter((g) => g.options.length > 0);

  async function assign(concept: SummaryConcept, lineId: string) {
    onSchemaUpdated(await statementSchemaRepository.save(assignConceptLine(schema, concept, lineId)));
  }

  return (
    <Card
      title={anyMissing ? 'Required lines' : 'Lines used'}
      icon="list-checks"
      padding="none"
      subtitle={expanded ? undefined : resolved.map((r) => r.line!.name).join(' · ')}
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
          {resolved.map(({ concept, line }) => (
            <div
              key={concept}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-5)',
                padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--border-default)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                <Icon
                  name={line ? 'check' : 'circle-alert'}
                  size={12}
                  color={line ? 'var(--status-positive-fg)' : 'var(--status-negative-fg)'}
                />
                {CONCEPT_LABELS[concept]}
              </span>
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
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
