import { createServer, request } from 'node:http'

const upstream = process.env.CEREMONY_SWS_URL

if (!upstream) throw new Error('CEREMONY_SWS_URL must serve the smoke artifact with the pinned SWS')

createServer((req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url
  const proxy = request(
    new URL(path, upstream),
    {
      method: req.method,
      headers: { ...req.headers, host: new URL(upstream).host },
    },
    (response) => {
      res.writeHead(response.statusCode, response.headers)
      response.pipe(res)
    },
  )
  proxy.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end()
  })
  req.pipe(proxy)
}).listen(4686, '127.0.0.1', () => console.log('Engine harness: http://localhost:4686'))
