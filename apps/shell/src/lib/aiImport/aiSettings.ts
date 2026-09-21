/**
 * The user's AI import settings: which review passes run, and any prompt they have edited. Kept in
 * localStorage on purpose — small, per-browser, and easy to replace with a stored setting once there is a
 * backend. Every read tolerates missing or unreadable storage and falls back to the defaults.
 */
export type ReviewPass = 'fill' | 'consolidate' | 'checks' | 'subLines';

export interface AiSettings {
  /** Edited prompt text by prompt id; absent means the built-in default. */
  prompts: Partial<Record<string, string>>;
  passes: Record<ReviewPass, boolean>;
}

const KEY = 'basis.aiSettings';
export const DEFAULT_PASSES: Record<ReviewPass, boolean> = { fill: true, consolidate: true, checks: true, subLines: true };

export function loadAiSettings(): AiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AiSettings> | null;
    return { prompts: raw?.prompts ?? {}, passes: { ...DEFAULT_PASSES, ...(raw?.passes ?? {}) } };
  } catch {
    return { prompts: {}, passes: { ...DEFAULT_PASSES } };
  }
}

function save(settings: AiSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private window, quota): the setting just doesn't persist.
  }
}

/** Saves an edit to a prompt; null (or text equal to the default, which the caller passes as null) restores the built-in one. */
export function setPromptOverride(id: string, text: string | null): void {
  const settings = loadAiSettings();
  const prompts = { ...settings.prompts };
  if (text === null) delete prompts[id];
  else prompts[id] = text;
  save({ ...settings, prompts });
}

export function setPassEnabled(pass: ReviewPass, enabled: boolean): void {
  const settings = loadAiSettings();
  save({ ...settings, passes: { ...settings.passes, [pass]: enabled } });
}
