import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import type { Plugin } from 'vite'

export interface LlmProxyOptions {
  /** Base URL of an OpenAI-compatible API, e.g. https://openrouter.ai/api/v1. */
  baseUrl: string
  apiKey: string
  /** Where cached responses live. */
  cacheDir: string
}

const PREFIX = '/api/llm/'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * DEV-SERVER ONLY. Forwards `/api/llm/*` to an OpenAI-compatible API and adds the API key server-side,
 * so the key never reaches the browser bundle. Successful responses are cached on disk by request hash,
 * so re-running the same workbook while iterating on the UI costs nothing.
 *
 * A production deployment replaces this with a real backend endpoint at the same path.
 */
export function llmProxyPlugin(options: LlmProxyOptions): Plugin {
  return {
    name: 'basis-llm-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(PREFIX) || req.method !== 'POST') return next()
        const send = (status: number, body: string) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(body)
        }
        try {
          const body = await readBody(req)
          const target = options.baseUrl.replace(/\/$/, '') + '/' + req.url.slice(PREFIX.length)
          const cacheFile = join(options.cacheDir, createHash('sha256').update(target + body).digest('hex') + '.json')

          try {
            const cached = await readFile(cacheFile, 'utf8')
            res.setHeader('X-Basis-Cache', 'hit')
            return send(200, cached)
          } catch {
            // not cached
          }

          const upstream = await fetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
            body,
          })
          const text = await upstream.text()
          if (upstream.ok) {
            await mkdir(options.cacheDir, { recursive: true })
            await writeFile(cacheFile, text)
          }
          send(upstream.status, text)
        } catch (error) {
          send(502, JSON.stringify({ error: { message: `LLM proxy failed: ${error instanceof Error ? error.message : String(error)}` } }))
        }
      })
    },
  }
}
