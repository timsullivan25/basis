import { useState } from 'react';
import { Badge, Button, Card, Switch } from '@basis/design-system';
import { loadAiSettings, setPassEnabled, setPromptOverride, type ReviewPass } from '../lib/aiImport/aiSettings';
import { PROMPTS, type PromptDef } from '../lib/aiImport/prompts';

const PASSES: { pass: ReviewPass; label: string; description: string }[] = [
  { pass: 'fill', label: 'Fill unmapped lines', description: 'Review with AI, pass 1. Places unmapped and tied target lines onto imported lines.' },
  { pass: 'consolidate', label: 'Consolidate leftover lines', description: 'Review with AI, pass 2. Adds unmapped imported lines onto an existing weak match.' },
  { pass: 'checks', label: 'Use failing checks', description: 'Review with AI, pass 3. Tries up to three rounds of changes to close a failing check, keeping only what helps.' },
  { pass: 'subLines', label: 'Suggest sub-lines', description: 'The "Suggest sub-lines" button. Turn off to hide it.' },
];

const GROUPS: { group: PromptDef['group']; title: string; icon: string }[] = [
  { group: 'import', title: 'Import: reading the workbook', icon: 'file-spreadsheet' },
  { group: 'mapping', title: 'Mapping review', icon: 'git-merge' },
  { group: 'structure', title: 'Sub-line suggestions', icon: 'git-branch' },
];

export function AiSettingsScreen() {
  const [settings, setSettings] = useState(loadAiSettings);

  const togglePass = (pass: ReviewPass, enabled: boolean) => {
    setPassEnabled(pass, enabled);
    setSettings(loadAiSettings());
  };
  const editPrompt = (def: PromptDef, text: string) => {
    setPromptOverride(def.id, text === def.defaultText ? null : text);
    setSettings(loadAiSettings());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gutter)', maxWidth: 960 }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>AI Import</h1>
        <p style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          The instructions the model is given at each step, and which review passes run. The format of the model's answer is fixed in code and
          checked afterwards, so the wording can change freely. Edits apply to the next run and are stored in this browser.
        </p>
      </div>

      <Card icon="toggle-right" title="Review passes">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {PASSES.map(({ pass, label, description }) => (
            <div key={pass} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-8)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{label}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{description}</div>
              </div>
              <Switch checked={settings.passes[pass]} onChange={(next) => togglePass(pass, next)} />
            </div>
          ))}
        </div>
      </Card>

      {GROUPS.map(({ group, title, icon }) => (
        <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-md)', margin: 0 }}>{title}</h2>
          {PROMPTS.filter((p) => p.group === group).map((def) => (
            <PromptCard key={def.id} def={def} text={settings.prompts[def.id] ?? def.defaultText} icon={icon} edited={settings.prompts[def.id] !== undefined} onChange={(text) => editPrompt(def, text)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PromptCard({ def, text, icon, edited, onChange }: { def: PromptDef; text: string; icon: string; edited: boolean; onChange: (text: string) => void }) {
  return (
    <Card
      icon={icon}
      title={def.label}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          {edited ? <Badge tone="caution">Edited</Badge> : null}
          <Button size="sm" variant="ghost" iconLeft="undo-2" disabled={!edited} onClick={() => onChange(def.defaultText)}>
            Reset to default
          </Button>
        </div>
      }
    >
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
        {def.description} <span style={{ color: 'var(--text-tertiary)' }}>Runs in: {def.usedBy}.</span>
      </div>
      <textarea
        aria-label={`${def.label} prompt`}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        rows={Math.min(28, Math.max(10, text.split('\n').length + 1))}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 'var(--space-4)',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: 1.5,
          color: 'var(--text-body)', background: 'var(--surface-sunken)',
          border: '1px solid var(--border-default)', borderRadius: 'var(--radius-2, 6px)',
        }}
      />
      <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', textAlign: 'right' }}>{text.length.toLocaleString()} characters</div>
    </Card>
  );
}
