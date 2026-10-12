import { useEffect, useState } from 'react';

/** TEMPORARY — a11y/readability experiment (branch: feature/readability-contrast).
 *  Lets a few structural tokens (table/section chrome) be swapped at runtime via
 *  `[data-contrast]` on <html>, so alternatives can be A/B'd live instead of edited and reloaded
 *  one at a time. Not meant to survive past the experiment: once a variant wins, bake its values
 *  into semantic.css directly and delete this file, contrastLab.css, and the one `useContrastVariant`
 *  call site (Accordion.jsx). */

export const CONTRAST_VARIANTS = [
  { key: 'default', label: 'Current', description: 'Today’s tokens, unchanged.' },
  { key: 'combo', label: 'Combo · A + C (tuned)', description: 'Table-head fill one notch lighter than A so it never matches a total row, plus C’s label darkening dialed back one notch.' },
  { key: 'a', label: 'A · Deeper tint', description: 'Darker gray chrome (table heads, borders, icons) + section headers stay tinted even when collapsed.' },
  { key: 'b', label: 'B · Brand tint', description: 'Chrome surfaces tinted blue instead of gray, tying structure to the existing brand color.' },
  { key: 'c', label: 'C · No new color', description: 'Same surfaces as today — only borders and label text get darker/heavier.' },
];

const STORAGE_KEY = 'basis:contrastVariant';
const EVENT = 'basis:contrastVariantChange';

export function getContrastVariant() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'default';
  } catch {
    return 'default';
  }
}

export function setContrastVariant(variant) {
  try {
    localStorage.setItem(STORAGE_KEY, variant);
  } catch {
    // ignore — private browsing / storage blocked, variant just won't persist across reloads
  }
  if (variant === 'default') document.documentElement.removeAttribute('data-contrast');
  else document.documentElement.setAttribute('data-contrast', variant);
  window.dispatchEvent(new Event(EVENT));
}

/** Applies whatever variant was last picked — call once at app startup so a reload doesn't
 *  silently revert to 'default' while localStorage still says otherwise. */
export function initContrastVariant() {
  const v = getContrastVariant();
  if (v !== 'default') document.documentElement.setAttribute('data-contrast', v);
}

export function useContrastVariant() {
  const [variant, setVariant] = useState(getContrastVariant);
  useEffect(() => {
    const onChange = () => setVariant(getContrastVariant());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return variant;
}
