import { readFileSync } from 'node:fs'

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

// Documents CCDP serves embed the shared unmodified font and its license, never fetching it.
export const documentStyles = `
/* ${read(`${brand}libron/LICENSE`)} */
@font-face {
  font-family: 'Libron';
  src: url(data:font/woff2;base64,${read(`${brand}libron/Libron-Regular.woff2`).toString('base64')}) format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}${theme}`
