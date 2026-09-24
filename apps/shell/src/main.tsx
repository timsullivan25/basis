import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initAiSettings } from './lib/aiImport/aiSettings.ts'

// Saved AI settings load first so the very first run already uses any edited prompt; a failure just means defaults.
void initAiSettings().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
