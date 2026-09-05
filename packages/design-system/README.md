# @basis/design-system

Tokens and React components shared across every Basis app. Ported from the
`basis-design-system` prototyping skill, minus the artifact-only files
(`.prompt.md`, `.card.html` demo pages, guideline docs).

## Structure

- `src/tokens/*.css` — CSS custom properties (color, type, space, elevation, motion). Imported as a whole via `src/styles.css`.
- `src/components/*` — one folder per category (`primitives`, `forms`, `navigation`, `disclosure`, `feedback`, `data`, `charts`). Each component is a `.jsx` file with a hand-written sibling `.d.ts`.
- `src/index.js` / `src/index.d.ts` — the public barrel export.

## Usage

This package ships uncompiled source (no build step) and is consumed directly
by other workspace packages via pnpm's `workspace:*` protocol:

```json
{ "dependencies": { "@basis/design-system": "workspace:*" } }
```

```tsx
import { Button, Card, SideNav } from '@basis/design-system';
import '@basis/design-system/styles.css';
```

Because the source is raw JSX, a consuming app's Vite config needs to widen
`@vitejs/plugin-react`'s transform beyond its `node_modules`-excluding default
— see `apps/shell/vite.config.ts` for the pattern.

## Extracting this package later

This package has no dependency on anything else in the monorepo (only
`react`/`react-dom` peer deps and `lucide-react`), so pulling it out into its
own repo or publishing it is just: copy this directory, add a real build step
(e.g. `vite build` in library mode, or `tsup`) so it ships compiled output
instead of raw source, and publish.

## Notable change from the original skill

`Icon` originally loaded Lucide from a CDN `<script>` tag at runtime (fine for
throwaway HTML artifacts, not for a real app). It now imports `lucide-react`
as a normal dependency and code-splits per icon via `lucide-react/dynamic`.
