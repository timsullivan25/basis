import { useState } from 'react';
import { Field, Input, SegmentedControl, Switch } from '@basis/design-system';
import type { LineInstanceContent } from '../../../data';

function parsePercent(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isNaN(n) ? undefined : n / 100;
}

/** Commit-on-blur/Enter, same convention as DcfPanel's WACC/terminal-growth inputs — a buffered
 *  local value that only calls back once it parses, so an in-progress "8." isn't clobbered. */
function PercentInput({ value, onCommit }: { value: number | undefined; onCommit: (next: number | undefined) => void }) {
  const [text, setText] = useState(() => (value === undefined ? '' : String(value * 100)));
  return (
    <Input
      size="sm"
      mono
      type="number"
      selectOnFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(parsePercent(text));
      }}
      onBlur={() => onCommit(parsePercent(text))}
    />
  );
}

function NumberInput({ value, onCommit }: { value: number | undefined; onCommit: (next: number | undefined) => void }) {
  const [text, setText] = useState(() => (value === undefined ? '' : String(value)));
  function commit() {
    const trimmed = text.trim();
    if (trimmed === '') return onCommit(undefined);
    const n = Number(trimmed);
    if (!Number.isNaN(n)) onCommit(n);
  }
  return (
    <Input
      size="sm"
      mono
      type="number"
      selectOnFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      onBlur={commit}
    />
  );
}

interface DebtTranchePropertiesEditorProps {
  instance: Partial<LineInstanceContent>;
  /** Only a tranche under 1L Debt can be a revolver — a revolver is always first-lien. */
  canBeRevolver: boolean;
  onChange: (patch: Partial<LineInstanceContent>) => void;
}

/** Property fields specific to a capital-structure debt tranche (LineInstance's optional debt
 *  fields — see its own doc comment) — maturity, coupon, and, for a revolver, its commitment
 *  amount/fee separate from the drawn balance the instance's own value/historicals represent. No
 *  projection or interest calculation reads these yet; that's Debt Schedule's concern. */
export function DebtTranchePropertiesEditor({ instance, canBeRevolver, onChange }: DebtTranchePropertiesEditorProps) {
  const debtType = instance.debtType ?? 'term';
  const isRevolver = canBeRevolver && debtType === 'revolver';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
        Tranche details
      </div>

      {canBeRevolver ? (
        <Field label="Type">
          <SegmentedControl
            size="sm"
            value={debtType}
            options={[{ value: 'term', label: 'Term' }, { value: 'revolver', label: 'Revolver' }]}
            onChange={(value) => onChange({ debtType: value as 'term' | 'revolver' })}
          />
        </Field>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <Field label="Maturity">
          <Input
            size="sm"
            type="date"
            value={instance.maturity ?? ''}
            onChange={(e) => onChange({ maturity: e.target.value || undefined })}
          />
        </Field>
        <Field label="Frequency">
          <SegmentedControl
            size="sm"
            value={instance.frequency ?? 'quarterly'}
            options={[{ value: 'quarterly', label: 'Quarterly' }, { value: 'semiAnnual', label: 'Semi-annual' }]}
            onChange={(value) => onChange({ frequency: value as 'quarterly' | 'semiAnnual' })}
          />
        </Field>

        <Field label={isRevolver ? 'Coupon (drawn)' : 'Coupon'}>
          <PercentInput value={instance.couponRate} onCommit={(couponRate) => onChange({ couponRate })} />
        </Field>
        <Field label="Coupon type">
          <SegmentedControl
            size="sm"
            value={instance.couponType ?? 'fixed'}
            options={[{ value: 'fixed', label: 'Fixed' }, { value: 'floating', label: 'Floating' }]}
            onChange={(value) => onChange({ couponType: value as 'fixed' | 'floating' })}
          />
        </Field>

        {instance.couponType === 'floating' ? (
          <Field label="Base rate" hint="e.g. SOFR — used by Debt Schedule, not yet resolved to a value here">
            <Input
              size="sm"
              value={instance.baseRate ?? ''}
              onChange={(e) => onChange({ baseRate: e.target.value || undefined })}
              placeholder="SOFR"
            />
          </Field>
        ) : null}

        {isRevolver ? (
          <>
            <Field label="Commitment amount" hint="The cap on what can be drawn — the tranche's own value is the drawn amount">
              <NumberInput value={instance.commitmentAmount} onCommit={(commitmentAmount) => onChange({ commitmentAmount })} />
            </Field>
            <Field label="Commitment fee" hint="Annual rate on the undrawn portion">
              <PercentInput value={instance.commitmentFeeRate} onCommit={(commitmentFeeRate) => onChange({ commitmentFeeRate })} />
            </Field>
          </>
        ) : null}

        <Field label="Original face value" hint="Falls back to this tranche's last historical value if left blank">
          <NumberInput value={instance.originalFaceValue} onCommit={(originalFaceValue) => onChange({ originalFaceValue })} />
        </Field>
        <Field label="Amortization" hint="Annual %, applied against original face value">
          <PercentInput value={instance.amortizationRate} onCommit={(amortizationRate) => onChange({ amortizationRate })} />
        </Field>
      </div>

      <Switch
        size="sm"
        checked={instance.repayable ?? true}
        onChange={(repayable) => onChange({ repayable })}
        label="Can be repaid from excess cash flow"
      />
    </div>
  );
}
