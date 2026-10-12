import type { CSSProperties, ReactNode } from 'react';

/**
 * Keeps the horizontal scroll position of every descendant marked `data-hscroll` in step, so a stack of
 * separate tables (one per statement section, plus the drivers table or chart) reads as one wide grid whose
 * period columns stay lined up however far you scroll. Scroll events don't bubble, so the capture phase is
 * used; the loop ends because an element already at the target position is left alone.
 */
export function SyncedHScroll({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={style}
      onScrollCapture={(event) => {
        const source = event.target;
        if (!(source instanceof HTMLElement) || source.dataset.hscroll === undefined) return;
        event.currentTarget.querySelectorAll<HTMLElement>('[data-hscroll]').forEach((el) => {
          if (el !== source && el.scrollLeft !== source.scrollLeft) el.scrollLeft = source.scrollLeft;
        });
      }}
    >
      {children}
    </div>
  );
}
