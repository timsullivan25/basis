import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Toast } from '@basis/design-system';
import { statementSchemaRepository, type StatementLine, type StatementSection } from '../data';
import { SectionEditor } from '../components/statements/SectionEditor';
import { validateFormula } from '../components/statements/formulaUtils';

function emptyLine(): StatementLine {
  return {
    id: crypto.randomUUID(),
    name: '',
    required: true,
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    formula: '',
    aliases: [],
  };
}

function moveWithinArray<T>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function StatementDefinitionsScreen() {
  const [sections, setSections] = useState<StatementSection[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const schema = await statementSchemaRepository.get();
      if (!cancelled) {
        setSections(schema.sections);
        setSavedSnapshot(JSON.stringify(schema.sections));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  function addSection() {
    setSections((prev) => [...prev, { id: crypto.randomUUID(), name: '', lines: [] }]);
  }

  function renameSection(sectionId: string, name: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, name } : s)));
  }

  function moveSection(sectionId: string, direction: 'up' | 'down') {
    setSections((prev) => moveWithinArray(prev, prev.findIndex((s) => s.id === sectionId), direction));
  }

  function deleteSection(sectionId: string) {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
  }

  function addLine(sectionId: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, lines: [...s.lines, emptyLine()] } : s)));
  }

  function updateLine(sectionId: string, lineId: string, patch: Partial<StatementLine>) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, lines: s.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)) }
          : s,
      ),
    );
  }

  function deleteLine(sectionId: string, lineId: string) {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, lines: s.lines.filter((line) => line.id !== lineId) } : s)),
    );
  }

  function moveLine(sectionId: string, lineId: string, direction: 'up' | 'down') {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, lines: moveWithinArray(s.lines, s.lines.findIndex((line) => line.id === lineId), direction) }
          : s,
      ),
    );
  }

  function moveLineToSection(fromSectionId: string, lineId: string, toSectionId: string) {
    setSections((prev) => {
      const fromSection = prev.find((s) => s.id === fromSectionId);
      const line = fromSection?.lines.find((l) => l.id === lineId);
      if (!line) return prev;
      return prev.map((s) => {
        if (s.id === fromSectionId) return { ...s, lines: s.lines.filter((l) => l.id !== lineId) };
        if (s.id === toSectionId) return { ...s, lines: [...s.lines, line] };
        return s;
      });
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await statementSchemaRepository.save({ sections });
      setSavedSnapshot(JSON.stringify(sections));
      setToast('Statement definitions saved');
    } finally {
      setSaving(false);
    }
  }

  const isDirty = savedSnapshot !== null && JSON.stringify(sections) !== savedSnapshot;

  const allLineNames = useMemo(
    () => sections.flatMap((s) => s.lines.map((line) => line.name)).filter(Boolean),
    [sections],
  );

  const errorLineCount = useMemo(
    () =>
      sections
        .flatMap((s) => s.lines)
        .filter((line) => validateFormula(line.formula, allLineNames).length > 0).length,
    [sections, allLineNames],
  );

  if (loading) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 style={{ fontSize: 'var(--text-xl)' }}>Financial statement definitions</h1>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            Sections and lines here define the structure every import and model is mapped against.
          </span>
        </div>
        <div style={{ flex: '1 1 auto' }} />
        <Button variant="primary" iconLeft="save" onClick={handleSave} loading={saving} disabled={!isDirty}>
          Save
        </Button>
      </div>

      {errorLineCount > 0 ? (
        <Alert tone="negative" compact>
          {errorLineCount} line{errorLineCount > 1 ? 's have' : ' has'} formula errors that need to be reviewed.
        </Alert>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
        {sections.map((section, index) => (
          <SectionEditor
            key={section.id}
            section={section}
            isFirst={index === 0}
            isLast={index === sections.length - 1}
            otherSections={sections.filter((s) => s.id !== section.id).map((s) => ({ id: s.id, name: s.name }))}
            allLineNames={allLineNames}
            onRename={(name) => renameSection(section.id, name)}
            onMoveUp={() => moveSection(section.id, 'up')}
            onMoveDown={() => moveSection(section.id, 'down')}
            onDelete={() => deleteSection(section.id)}
            onAddLine={() => addLine(section.id)}
            onUpdateLine={(lineId, patch) => updateLine(section.id, lineId, patch)}
            onDeleteLine={(lineId) => deleteLine(section.id, lineId)}
            onMoveLine={(lineId, direction) => moveLine(section.id, lineId, direction)}
            onMoveLineToSection={(lineId, toSectionId) => moveLineToSection(section.id, lineId, toSectionId)}
          />
        ))}
      </div>

      <Button variant="secondary" iconLeft="plus" onClick={addSection} style={{ alignSelf: 'flex-start' }}>
        Add section
      </Button>

      {toast ? (
        <div style={{ position: 'fixed', right: 'var(--space-8)', bottom: 'var(--space-8)', zIndex: 200 }}>
          <Toast tone="positive" title={toast} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}
