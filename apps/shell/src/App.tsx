import { AppShell } from './AppShell';
import { ContrastLabSwitcher } from './dev/ContrastLabSwitcher';

// Flip to true when actively A/B-ing chrome contrast again (see ContrastLabSwitcher's own doc
// comment) — off by default so it doesn't clutter every other dev session in the meantime.
const SHOW_CONTRAST_LAB = false;

function App() {
  return (
    <>
      <AppShell />
      {SHOW_CONTRAST_LAB && import.meta.env.DEV ? <ContrastLabSwitcher /> : null}
    </>
  );
}

export default App;
