# basis

Consolidated foundation project, built up from the example projects in `../basis-design-system-main`, `../financial-model-importer-main`, `../issuer-dashboard-main`, and `../Main modeling screen workflow`.

pnpm workspace monorepo:

- [`packages/design-system`](packages/design-system) — shared tokens and React components. See its README for details.
- [`apps/shell`](apps/shell) — the application shell (Vite + React 19 + TypeScript): header bar and sidebar navigation, consuming the design system.

## Getting started

```bash
pnpm install
pnpm dev    # runs the shell app
```
