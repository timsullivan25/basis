import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { aiSettingsPlugin } from './aiSettingsPlugin.ts'
import { llmProxyPlugin } from './llmProxyPlugin.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // LLM_* live in .env.local and are read here, server-side only. They deliberately lack the VITE_
  // prefix so the API key is never bundled into the browser; only the (non-secret) model name is.
  const env = loadEnv(mode, process.cwd(), 'LLM_')
  const llmConfigured = Boolean(env.LLM_API_KEY && env.LLM_BASE_URL && env.LLM_MODEL)

  return {
    plugins: [
      // @basis/design-system ships uncompiled .jsx from a workspace package (resolved
      // through node_modules), so widen the transform to cover it instead of the
      // plugin's default `exclude: /node_modules/`.
      react({ include: /\/(src|design-system)\/.*\.[jt]sx?$/ }),
      aiSettingsPlugin({ file: 'ai-settings.json' }),
      ...(llmConfigured
        ? [llmProxyPlugin({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, cacheDir: '.llm-cache' })]
        : []),
    ],
    define: {
      __LLM_MODEL__: JSON.stringify(llmConfigured ? env.LLM_MODEL : ''),
      // Optional JSON object merged into every request body (e.g. {"reasoning":{"enabled":false}}); not secret.
      __LLM_EXTRA_BODY__: JSON.stringify(env.LLM_EXTRA_BODY ?? ''),
    },
    optimizeDeps: {
      exclude: ['@basis/design-system'],
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    test: {
      // Every engine test target (parse/graph/evaluate) is plain TS with no DOM dependency.
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
