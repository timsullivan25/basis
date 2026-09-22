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
  /** Fixed, non-collapsible content shown above the accordion — e.g. a line-type selector whose
   *  choice determines which sections even apply below it, so it isn't itself one of them. */
  beforeSections?: ReactNode;
  /** A persistent action (e.g. "Delete sub-line") that isn't itself a collapsible setting. */
  footer?: ReactNode;
  /** Lets each screen control height/position (sticky vs. matching a table's own maxHeight) —
   *  the panel has no scroll opinion of its own beyond filling whatever height it's given. */
  style?: CSSProperties;
}

/** Shared side-panel shell for a selected line's controls, replacing the inline expanded-row
 *  pattern in both SectionEditor and ModelMappingScreen. Purely presentational — each screen
 *  supplies its own accordion sections built from its existing detail components. */
export function LineSettingsPanel({ title, subtitle, icon, onClose, sections, openKeys, onToggleSection, beforeSections, footer, style }: LineSettingsPanelProps) {
  return (
    // A flex column, not just a maxHeight box: `height: 100%` on the Card below never resolves
    // against a parent whose own height comes only from `max-height` (percentages need a definite
    // parent height, which max-height alone doesn't give — the box's content just overflows it
    // instead of the Card ever actually being constrained). Sizing the Card with `flex: 1 1 auto`
    // against this flex container sidesteps that: flex-grow/shrink distribute this box's own
    // (max-height-capped) space directly, no percentage resolution involved, so the Card is
    // reliably clipped to it and its own overflow:auto body can do the actual scrolling.
    <div style={{ width: 420, flex: '0 0 auto', display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      <Card
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={<IconButton icon="x" label="Close" size="sm" variant="ghost" onClick={onClose} />}
        footer={footer}
        padding="none"
        style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ overflow: 'auto', minHeight: 0 }}
      >
        {beforeSections ? (
          <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)' }}>{beforeSections}</div>
        ) : null}
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
