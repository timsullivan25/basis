import { AppShell } from './AppShell';
import { ContrastLabSwitcher } from './dev/ContrastLabSwitcher';

function App() {
  return (
    <>
      <AppShell />
      {import.meta.env.DEV ? <ContrastLabSwitcher /> : null}
    </>
  );
}

export default App;
