import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // @basis/design-system ships uncompiled .jsx from a workspace package (resolved
    // through node_modules), so widen the transform to cover it instead of the
    // plugin's default `exclude: /node_modules/`.
    react({ include: /\/(src|design-system)\/.*\.[jt]sx?$/ }),
  ],
  optimizeDeps: {
    exclude: ['@basis/design-system'],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
})
