import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initContrastVariant } from '@basis/design-system'
import './index.css'
import App from './App.tsx'
import { initAiSettings } from './lib/aiImport/aiSettings.ts'

// TEMPORARY — readability experiment (branch: feature/readability-contrast). Reapplies whatever
// contrast variant was last picked, since the `data-contrast` attribute itself doesn't survive a
// reload on its own (only the localStorage record does).
initContrastVariant();

// Saved AI settings load first so the very first run already uses any edited prompt; a failure just means defaults.
void initAiSettings().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
