import { readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'

const ROUTE = '/api/dev/ai-settings'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * DEV-SERVER ONLY. Reads and writes the AI import settings (edited prompts, pass switches) as a JSON file in the
 * project, so they are versioned with the code and shared by every browser on this checkout. A production
 * deployment replaces this with a real backend endpoint at the same path.
 */
export function aiSettingsPlugin(options: { file: string }): Plugin {
  return {
    name: 'basis-ai-settings',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== ROUTE) return next()
        res.setHeader('Content-Type', 'application/json')
        try {
          if (req.method === 'GET') {
            res.end(await readFile(options.file, 'utf8').catch(() => '{}'))
          } else if (req.method === 'PUT') {
            const body = await readBody(req)
            JSON.parse(body) // refuse anything that isn't JSON
            await writeFile(options.file, JSON.stringify(JSON.parse(body), null, 2) + '\n')
            res.end('{}')
          } else {
            res.statusCode = 405
            res.end('{}')
          }
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      })
    },
  }
}
