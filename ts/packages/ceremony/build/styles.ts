import { readFileSync } from 'node:fs'
import { ASSETS_PREFIX } from '../src/assets/keys.ts'
import { hash } from './sources.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url))
const brand = '../../../../brand/'
const { logo, dark, light } = JSON.parse(read(`${brand}palette.json`).toString())
const variables = (colors: Record<string, string>) =>
  Object.entries({ ...colors, logo })
    .map(([name, value]) => `--${name}:${value};`)
    .join('')

const theme = `
:root { color-scheme: dark; ${variables(dark)} }
@media (prefers-color-scheme: light) {
  :root { color-scheme: light; ${variables(light)} }
}
${read('../src/ccdp/documents/ui.css')}`

// Palette and layout only: the policy Bridges compose for Callback admits no fonts. Its hop
// takes milliseconds, so it shows only the bar until it stops with a message, never fallback text.
export const callbackStyles = `${theme}
#libid-root:has(progress) > :not(progress) { visibility: hidden; }`

/** The shared unmodified Libron Regular font emitted as an immutable same-origin asset. */
export const documentFontBytes = read(`${brand}libron/Libron-Regular.woff2`)
export const documentFontPath = `${ASSETS_PREFIX}fonts/libron-${hash(documentFontBytes)}.woff2`

/** The font's license, published once beside it instead of inside every document. */
export const documentFontLicense = read(`${brand}libron/LICENSE`)
export const documentFontLicensePath = `${ASSETS_PREFIX}fonts/libron-LICENSE-${hash(documentFontLicense)}.txt`

// Documents CCDP serves reference the immutable same-origin font and name its license file.
export const documentStyles = `
/* Libron: SIL Open Font License 1.1, ${documentFontLicensePath} */
@font-face {
  font-family: 'Libron';
  src: url(${documentFontPath}) format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}${theme}`
