import { scriptHash } from '../build/profiles.ts'

/** Reference Bridge data insertion only; this is not a production Bridge server. */
export function prepareCallback(
  html: string,
  sourceHeaders: Record<string, string>,
  inputs: readonly [readonly string[], string, ...unknown[]],
) {
  const ccdpOrigin = inputs[1]
  const marker = '__LIBID_CALLBACK_CONFIG__'
  const slot = `<script id="libid-callback-config" type="application/json">${marker}</script>`
  const headers = new Headers(sourceHeaders)
  const policy = headers.get('Content-Security-Policy') ?? ''
  const scriptPolicies = [...policy.matchAll(/(?:^|;)\s*script-src\s+([^;]+)/g)]
  const scripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)]
  const executable = scripts.filter(([script]) => script !== slot)
  const code =
    executable.length === 1
      ? /^<script type="module">([\s\S]*)<\/script>$/.exec(executable[0][0])?.[1]
      : undefined
  if (
    headers.get('Content-Type') !== 'text/html; charset=utf-8' ||
    headers.get('X-Content-Type-Options') !== 'nosniff' ||
    html.split(marker).length !== 2 ||
    !html.includes(slot) ||
    scripts.length !== 2 ||
    !code ||
    scriptPolicies.length !== 1 ||
    scriptPolicies[0][1].trim() !== scriptHash(code) ||
    new URL(ccdpOrigin).origin !== ccdpOrigin ||
    !ccdpOrigin.startsWith('https://')
  )
    throw new Error('Invalid Callback artifact')
  const data = JSON.stringify(inputs).replace(/</g, '\\u003c')
  return {
    body: html.replace(slot, () => slot.replace(marker, () => data)),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'unsafe-none',
      'Content-Security-Policy': `default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src ${scriptHash(code)}; style-src 'unsafe-inline'; frame-src ${ccdpOrigin}; connect-src 'none'`,
    },
  }
}
