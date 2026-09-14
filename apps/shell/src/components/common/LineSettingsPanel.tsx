import type { CSSProperties, ReactNode } from 'react';
import { Accordion, Card, IconButton } from '@basis/design-system';

export interface LineSettingsSection {
  key: string;
  label: string;
  icon?: string;
  summary?: string;
  content: ReactNode;
}

interface LineSettingsPanelProps {
  title: string;
  subtitle?: string;
  icon?: string;
  onClose: () => void;
  sections: LineSettingsSection[];
  openKeys: string[];
  onToggleSection: (key: string) => void;
  /** A persistent action (e.g. "Delete sub-line") that isn't itself a collapsible setting. */
  footer?: ReactNode;
  /** Lets each screen control height/position (sticky vs. matching a table's own maxHeight) —
   *  the panel has no scroll opinion of its own beyond filling whatever height it's given. */
  style?: CSSProperties;
}

/** Shared side-panel shell for a selected line's controls, replacing the inline expanded-row
 *  pattern in both SectionEditor and ModelMappingScreen. Purely presentational — each screen
 *  supplies its own accordion sections built from its existing detail components. */
export function LineSettingsPanel({ title, subtitle, icon, onClose, sections, openKeys, onToggleSection, footer, style }: LineSettingsPanelProps) {
  return (
    <div style={{ width: 420, flex: '0 0 auto', ...style }}>
      <Card
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={<IconButton icon="x" label="Close" size="sm" variant="ghost" onClick={onClose} />}
        footer={footer}
        padding="none"
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ overflow: 'auto', minHeight: 0 }}
      >
        <Accordion
          items={sections}
          openKeys={openKeys}
          onToggle={onToggleSection}
          style={{ border: 'none', borderRadius: 0 }}
        />
      </Card>
    </div>
  );
}
