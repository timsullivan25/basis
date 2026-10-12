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
      const log = server.config.logger
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
            log.info('[llm] cache hit')
            return send(200, cached)
          } catch {
            // not cached
          }

          const started = Date.now()
          const upstream = await fetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
            body,
          })
          const text = await upstream.text()
          const seconds = ((Date.now() - started) / 1000).toFixed(1)
          if (upstream.ok) {
            let tokens = ''
            let cacheable = false
            try {
              const body = JSON.parse(text)
              const choice = body.choices?.[0]
              // Only cache clean answers, so a garbled or truncated reply is never replayed.
              cacheable = choice?.finish_reason === 'stop' && typeof choice?.message?.content === 'string' && choice.message.content.includes('{')
              const usage = body.usage
              tokens = ` — ${usage?.completion_tokens ?? '?'} completion tokens (${usage?.completion_tokens_details?.reasoning_tokens ?? 0} reasoning)`
            } catch {
              // body wasn't JSON; nothing to summarize
            }
            log.info(`[llm] ${upstream.status} in ${seconds}s${tokens}`)
            if (cacheable) {
              await mkdir(options.cacheDir, { recursive: true })
              await writeFile(cacheFile, text)
              await writeFile(cacheFile.replace(/\.json$/, '.request.json'), body) // for replaying the exact call
            } else {
              // Keep the exchange so a bad reply can be replayed and diagnosed.
              const failedDir = join(options.cacheDir, 'failed')
              await mkdir(failedDir, { recursive: true })
              await writeFile(join(failedDir, `${Date.now()}.json`), JSON.stringify({ request: JSON.parse(body), response: JSON.parse(text) }, null, 2))
              log.warn('[llm] reply not cached (unclean finish or no JSON object); saved to .llm-cache/failed/')
            }
          } else {
            log.error(`[llm] ${upstream.status} in ${seconds}s: ${text.slice(0, 500)}`)
          }
          send(upstream.status, text)
        } catch (error) {
          log.error(`[llm] proxy error: ${error instanceof Error ? error.message : String(error)}`)
          send(502, JSON.stringify({ error: { message: `LLM proxy failed: ${error instanceof Error ? error.message : String(error)}` } }))
        }
      })
    },
  }
}
