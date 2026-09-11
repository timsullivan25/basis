import { useState } from 'react';
import { Button, Input } from '@basis/design-system';
import type { ParsedWorkbook } from '../../../data';
import type { InstanceTarget } from '../instances/InstancesPanel';
import { SourceLineChecklist } from './SourceLineChecklist';

interface AddInstanceRowDetailProps {
  target: InstanceTarget;
  sectionName: string;
  workbook: ParsedWorkbook;
  onCreate: (input: { name: string; sourceLineIds: string[] }) => void;
}

/** The inline creator behind a "+ Add sub-line"/"+ Add KPI" synthetic row in the mapping
 *  screen — a name field plus the same SourceLineChecklist MappingRowDetail uses for an
 *  existing target line, since creating an instance here is really just mapping a not-yet-
 *  existing line (see Phase 9 plan's Slice 4). Local until "Add line" commits it — nothing
 *  here writes to the model directly; the caller decides whether to persist immediately
 *  (an existing model) or hold it as a draft until Save (a fresh import). */
export function AddInstanceRowDetail({ target, sectionName, workbook, onCreate }: AddInstanceRowDetailProps) {
  const [name, setName] = useState('');
  const [sourceLineIds, setSourceLineIds] = useState<string[]>([]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, sourceLineIds });
    setName('');
    setSourceLineIds([]);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--space-9)' }}>
      <SourceLineChecklist
        title={`Map new ${target.kind === 'section' ? 'KPI' : 'sub-line'} from`}
        sectionName={sectionName}
        workbook={workbook}
        sourceLineIds={sourceLineIds}
        onSetSourceLines={setSourceLineIds}
      />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          {target.kind === 'section' ? 'KPI' : 'Sub-line'} name
        </div>
        <Input
          size="sm"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={target.kind === 'section' ? 'e.g. Monthly Active Users' : `e.g. Segment A`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <Button size="sm" variant="primary" iconLeft="plus" disabled={!name.trim()} onClick={submit}>
          Add {target.kind === 'section' ? 'KPI' : 'sub-line'}
        </Button>
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
          Rolls up into {target.name}. Method and driver can be set afterward from the model workspace.
        </p>
      </div>
    </div>
  );
}
