import https from 'node:https'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { packageDir } from '../build/release.ts'
import { makeCertificate } from './tls.mjs'
const root = join(packageDir, '.cache/smoke')
https
  .createServer(makeCertificate(['localhost']), (req, res) => {
    const path = new URL(req.url, 'https://localhost').pathname
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`)
    if (!file.startsWith(`${root}/`)) {
      res.writeHead(404).end()
      return
    }
    try {
      const body = readFileSync(file)
      res.writeHead(200, {
        'Content-Type': file.endsWith('.html')
          ? 'text/html'
          : file.endsWith('.js')
            ? 'text/javascript'
            : file.endsWith('.json')
              ? 'application/json'
              : 'application/wasm',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Cache-Control': 'no-store',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  .listen(4686, '127.0.0.1', () => console.log('Engine harness: https://localhost:4686'))
