import { useState } from 'react';
import { Badge, Button, Checkbox, Dialog } from '@basis/design-system';
import type { LineMapping, ParsedSourceLine, ParsedWorkbook, StatementSchema } from '../../../data';
import { tieOut, type StructureOp } from '../../../lib/aiImport/proposeStructure';
import { formatPeriodValue } from './mappingFormatting';

interface StructureProposalDialogProps {
  open: boolean;
  ops: StructureOp[];
  schema: StatementSchema;
  workbook: ParsedWorkbook;
  mapping: Record<string, LineMapping>;
  onApply: (ops: StructureOp[]) => void;
  onClose: () => void;
}

const TONE = { high: 'positive', medium: 'info', low: 'caution' } as const;

/** Review list for AI-proposed sub-lines: each is accepted or rejected on its own, with the evidence code computed beside it. */
export function StructureProposalDialog({ open, ops, schema, workbook, mapping, onApply, onClose }: StructureProposalDialogProps) {
  const [rejected, setRejected] = useState<ReadonlySet<number>>(new Set());
  const lines = schema.sections.flatMap((s) => s.lines);
  const parentName = (id: string) => lines.find((l) => l.id === id)?.name ?? '';
  const sourceById = (id: string): ParsedSourceLine | undefined => workbook.lines.find((l) => l.id === id);
  const lastIndex = workbook.periods.length - 1;
  const accepted = ops.filter((_, i) => !rejected.has(i));
  const parentIds = [...new Set(ops.map((o) => o.parentLineId))];

  const toggle = (i: number) => setRejected((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon="sparkles"
      title="Suggested sub-lines"
      subtitle="Each becomes a real sub-line of its parent, mapped from the imported lines shown. Untick any you don't want."
      width={720}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={accepted.length === 0} onClick={() => onApply(accepted)}>
            Add {accepted.length} sub-line{accepted.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {ops.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          No sub-lines to suggest — the unmatched lines don't clearly break down any parent line.
        </p>
      ) : (
        <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
          {parentIds.map((parentId) => {
            const evidence = tieOut(ops, parentId, workbook, mapping);
            return (
              <div key={parentId} style={{ marginBottom: 'var(--space-6)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-6)', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
                  <span>Under {parentName(parentId)}</span>
                  <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 'var(--weight-regular)' }}>
                    {evidence.parent === null
                      ? `Total ${formatPeriodValue(evidence.proposed)}`
                      : `Total ${formatPeriodValue(evidence.proposed)} vs ${parentName(parentId)} ${formatPeriodValue(evidence.parent)}`}
                  </span>
                </div>
                {ops.map((op, i) => op.parentLineId !== parentId ? null : (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-5)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <Checkbox checked={!rejected.has(i)} onChange={() => toggle(i)} label="" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                        {op.name} <Badge tone={TONE[op.confidence]}>{op.confidence}</Badge>
                      </div>
                      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
                        {op.sourceLineIds.map((id) => {
                          const s = sourceById(id);
                          return s ? `${[s.section, s.group].filter(Boolean).join(' - ')} · ${s.name} · ${formatPeriodValue(s.values[lastIndex] ?? null)}` : '';
                        }).join('  +  ')}
                      </div>
                      {op.reason ? <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>{op.reason}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
