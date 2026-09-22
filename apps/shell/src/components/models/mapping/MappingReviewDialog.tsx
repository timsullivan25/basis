import { useState } from 'react';
import { Badge, Button, Dialog, Icon } from '@basis/design-system';
import type { LineMapping, ParsedWorkbook, StatementLine, StatementSchema } from '../../../data';
import * as schemaEdit from '../../../lib/statementSchemaEdit';
import type { NameIndex } from '../../../lib/engine/resolve';
import { formatFormula } from '../../../lib/engine/resolve';
import { buildMappingRowSections } from './mappingRowSections';
import { getRequiredMeta } from '../../statements/statementFormatting';
import { needsReview } from './mappingFormatting';
import { blankMapping, isDebtScheduleGenerated } from './ModelMappingScreen';
import { isFormulaOnly } from '../../../lib/lineRole';

export interface MappingReviewItem {
  id: string;
  sectionName: string;
}

interface MappingReviewDialogProps {
  /** Frozen at the moment the dialog was opened (by ModelMappingScreen) — see its own comment on
   *  why: recomputing this live from the current mapping would shrink/reorder the list under the
   *  reviewer's feet the instant they resolved a line. Each item's own live status (still flagged
   *  vs. reviewed) is still read fresh from `mapping` on every render, only the queue itself is
   *  fixed for the session. */
  items: MappingReviewItem[];
  /** Shown once before the first line — the "Review with AI" entry point's own run summary. Left
   *  out for the plain "Review flagged" button, which jumps straight into the queue. */
  summary?: string;
  schema: StatementSchema;
  workbook: ParsedWorkbook;
  mapping: Record<string, LineMapping>;
  nameIndex: NameIndex;
  onSetSourceLines: (target: StatementLine, sourceLineIds: string[]) => void;
  onApprove: (lineId: string) => void;
  onReject: (lineId: string) => void;
  onClose: () => void;
}

/** Monarch-style "flip through every flagged line" review — one line at a time, full-width, with
 *  the exact same mapping controls (candidates / source checklist / match details) the side panel
 *  already uses, just laid out flat instead of collapsed into an accordion since there's a whole
 *  dialog's worth of room here. Reads and writes the same `mapping` state and handlers as the main
 *  screen — this is strictly an alternate way to drive the same data, not a new one. */
export function MappingReviewDialog({ items, summary, schema, workbook, mapping, nameIndex, onSetSourceLines, onApprove, onReject, onClose }: MappingReviewDialogProps) {
  const [showingSummary, setShowingSummary] = useState(Boolean(summary));
  const [index, setIndex] = useState(0);

  if (items.length === 0) {
    return (
      <Dialog
        open
        icon="check-circle-2"
        title="Nothing to review"
        onClose={onClose}
        footer={<Button variant="primary" onClick={onClose}>Close</Button>}
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          Every mappable line is already above the confidence threshold.
        </p>
      </Dialog>
    );
  }

  if (showingSummary) {
    return (
      <Dialog
        open
        icon="sparkles"
        title="AI review finished"
        onClose={onClose}
        width={520}
        footer={
          <>
            <Button onClick={onClose}>Skip review</Button>
            <Button variant="primary" iconLeft="list-checks" onClick={() => setShowingSummary(false)}>
              Review {items.length} flagged line{items.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>{summary}</p>
      </Dialog>
    );
  }

  const item = items[index];
  const line = schemaEdit.findLine(schema, item.id);
  if (!line) {
    // Can't actually happen today — this modal blocks the rest of the screen, and nothing that
    // could remove a line from the schema is reachable while it's open — but keeps this a graceful
    // no-op rather than a crash if that ever stops being true.
    onClose();
    return null;
  }

  const isLast = index === items.length - 1;
  function advance() {
    if (index + 1 < items.length) setIndex(index + 1);
    else onClose();
  }

  const lineMapping = mapping[item.id] ?? blankMapping(item.id);
  const rowNeedsReview = needsReview(line, mapping[item.id]);
  const meta = getRequiredMeta(line);
  const sections = buildMappingRowSections({
    target: line,
    sectionName: item.sectionName,
    mapping: lineMapping,
    workbook,
    onSetSourceLines: (ids) => onSetSourceLines(line, ids),
    onApprove: () => {
      onApprove(line.id);
      advance();
    },
    onReject: () => onReject(line.id),
    calculatedByDebtSchedule: isDebtScheduleGenerated(line),
    calculated: isFormulaOnly(line),
    formula: formatFormula(line.formula, nameIndex),
  });

  return (
    <Dialog
      open
      icon="git-merge"
      title={line.name}
      subtitle={`${item.sectionName} · ${index + 1} of ${items.length}`}
      width={680}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" iconLeft="chevron-left" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            Previous
          </Button>
          <Button variant={rowNeedsReview ? 'secondary' : 'primary'} iconLeft={isLast ? 'check' : 'chevron-right'} onClick={advance}>
            {isLast ? 'Done' : rowNeedsReview ? 'Skip' : 'Next'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <Badge tone={meta.tone} size="sm">{meta.label}</Badge>
        {!rowNeedsReview ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-2xs)', color: 'var(--text-positive)' }}>
            <Icon name="check-circle-2" size={12} color="var(--text-positive)" />
            Reviewed
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
        {sections.map((section, i) => (
          <div key={section.key} style={i > 0 ? { paddingTop: 'var(--space-6)', borderTop: '1px solid var(--border-subtle)' } : undefined}>
            <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              {section.label}
            </div>
            {section.content}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
