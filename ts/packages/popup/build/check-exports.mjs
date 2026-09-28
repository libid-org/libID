// The emitted declarations must keep two boundaries (POPUP-API-005 and the
// worker subpath): `bind` never reaches the public PopupWindow declaration,
// and no worker-global type reaches the main entry's declaration graph.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist')
const read = (file) => readFileSync(join(dist, file), 'utf8')

if (/\bbind\s*\(/.test(read('window.d.ts'))) {
  throw new Error('PopupWindow declaration must not expose bind')
}
for (const file of ['index.d.ts', 'connection.d.ts', 'window.d.ts', 'port.d.ts', 'keeper.d.ts']) {
  if (/ServiceWorkerGlobalScope|ExtendableMessageEvent/.test(read(file))) {
    throw new Error(`${file} must not reference worker-global types`)
  }
}
if (!/export declare function installPortKeeper\(\): void/.test(read('worker.d.ts'))) {
  throw new Error('worker entry must export installPortKeeper()')
}
