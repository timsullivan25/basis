import { IconButton, Popover } from '@basis/design-system';

const rowStyle = { display: 'flex', gap: 'var(--space-4)', alignItems: 'baseline' } as const;
const codeStyle = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-primary)', flex: '0 0 auto' } as const;
const headingStyle = {
  fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)',
  textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)',
} as const;

const FUNCTIONS: { signature: string; description: string }[] = [
  { signature: 'sum(a, b, …)', description: 'Total of the values' },
  { signature: 'avg(a, b, …)', description: 'Average of the values' },
  { signature: 'min(a, b, …)', description: 'Smallest value' },
  { signature: 'max(a, b, …)', description: 'Largest value' },
  { signature: 'abs(x)', description: 'Value without its sign' },
  { signature: 'priorPeriod(x)', description: "x in the previous period" },
  { signature: 'priorYear(x)', description: 'x in the same period a year earlier' },
];

/** Info button that opens a short reference for the formula language (parse.ts's operators and
 *  functions) — there's no other place the user could discover that e.g. priorPeriod() exists. */
export function FormulaHelp() {
  return (
    <Popover
      placement="top-start"
      width={300}
      title="Formula reference"
      trigger={<IconButton icon="info" label="Formula help" size="sm" variant="ghost" />}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <div>
          <div style={headingStyle}>Lines</div>
          Type a line name and pick it from the list. If a name appears in more than one section, qualify it, e.g. <span style={codeStyle}>Income Statement.Revenue</span>.
        </div>
        <div>
          <div style={headingStyle}>Operators</div>
          <span style={codeStyle}>+ − * / ^</span> and parentheses. <span style={codeStyle}>^</span> is power.
        </div>
        <div>
          <div style={headingStyle}>Functions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {FUNCTIONS.map((f) => (
              <div key={f.signature} style={rowStyle}>
                <span style={{ ...codeStyle, minWidth: 108 }}>{f.signature}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{f.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Popover>
  );
}
