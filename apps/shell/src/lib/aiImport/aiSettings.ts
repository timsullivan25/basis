/**
 * The user's AI import settings: which review passes run, and any prompt they have edited. They live in
 * `ai-settings.json` in the project, read and written through the dev server (`aiSettingsPlugin.ts`), so an edit
 * is a reviewable change that is committed with the code. Reads are synchronous from an in-memory copy loaded at
 * startup; when the endpoint is unavailable the defaults apply and edits last only for the session. A backend
 * replaces the endpoint, not this module's interface.
 */
export type ReviewPass = 'fill' | 'consolidate' | 'checks' | 'subLines';

export interface AiSettings {
  /** Edited prompt text by prompt id; absent means the built-in default. */
  prompts: Partial<Record<string, string>>;
  passes: Record<ReviewPass, boolean>;
}

const ENDPOINT = '/api/dev/ai-settings';
export const DEFAULT_PASSES: Record<ReviewPass, boolean> = { fill: true, consolidate: true, checks: true, subLines: true };

let current: AiSettings = { prompts: {}, passes: { ...DEFAULT_PASSES } };

function normalize(raw: Partial<AiSettings> | null | undefined): AiSettings {
  return { prompts: { ...(raw?.prompts ?? {}) }, passes: { ...DEFAULT_PASSES, ...(raw?.passes ?? {}) } };
}

/** Loads the saved settings once at startup. Never throws: any failure leaves the defaults. */
export async function initAiSettings(): Promise<void> {
  try {
    const response = await fetch(ENDPOINT);
    if (response.ok) current = normalize((await response.json()) as Partial<AiSettings>);
  } catch {
    // No endpoint (tests, a build without the dev server): defaults.
  }
}

export function loadAiSettings(): AiSettings {
  return current;
}

async function persist(): Promise<void> {
  try {
    await fetch(ENDPOINT, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current) });
  } catch {
    // The edit still applies for this session.
  }
}

/** Saves an edit to a prompt; null restores the built-in one. */
export function setPromptOverride(id: string, text: string | null): void {
  const prompts = { ...current.prompts };
  if (text === null) delete prompts[id];
  else prompts[id] = text;
  current = { ...current, prompts };
  void persist();
}

export function setPassEnabled(pass: ReviewPass, enabled: boolean): void {
  current = { ...current, passes: { ...current.passes, [pass]: enabled } };
  void persist();
}

/** Test hook: back to the defaults, without touching the endpoint. */
export function resetAiSettingsForTests(): void {
  current = normalize(null);
}
