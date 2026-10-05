import { parseCsp, scriptHash } from '../build/profiles.ts'
import { documentHeaders } from '../src/assets/headers.ts'

/** The deployment inputs Callback reads, inserted in its positional order. */
type CallbackInputs = { allowedApplicationOrigins: readonly string[]; ccdpOrigin: string }

/** Inserts the Bridge's Callback data into the built artifact, as a reference Bridge does. */
export function prepareCallback(
  html: string,
  sourceHeaders: Record<string, string>,
  { allowedApplicationOrigins, ccdpOrigin }: CallbackInputs,
) {
  const marker = '__LIBID_CALLBACK_CONFIG__'
  const slot = `<script id="libid-callback-config" type="application/json">${marker}</script>`
  const headers = new Headers(sourceHeaders)
  const policy = headers.get('Content-Security-Policy') ?? ''
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
    parseCsp(policy).get('script-src')?.join(' ') !== scriptHash(code) ||
    new URL(ccdpOrigin).origin !== ccdpOrigin ||
    !(
      ccdpOrigin.startsWith('https://') ||
      (ccdpOrigin.startsWith('http://') &&
        ['localhost', '127.0.0.1'].includes(new URL(ccdpOrigin).hostname))
    )
  )
    throw new Error('Invalid Callback artifact')
  const data = JSON.stringify([allowedApplicationOrigins, ccdpOrigin]).replace(/</g, '\\u003c')
  return {
    body: html.replace(slot, () => slot.replace(marker, () => data)),
    headers: {
      ...documentHeaders,
      'Cache-Control': 'no-store',
      // Inserting data changes no executable, so the artifact's own policy still applies.
      'Content-Security-Policy': policy,
    },
  }
}
