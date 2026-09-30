import type { Plugin, Rollup } from 'vite'
import { build } from 'vite'

/**
 * Import a `src` module into this Node process. The sources resolve one another
 * through `.js` specifiers, which only the bundler maps back to `.ts`, so the
 * module is compiled into one self-contained chunk and loaded from a data URL.
 */
export async function importSource<T>(entry: string, plugins: Plugin[] = []): Promise<T> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins,
    build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
  })
  const output = ((Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput).output
  const code = output.find((o) => o.type === 'chunk')!
  return (await import(
    `data:text/javascript;base64,${Buffer.from(code.code).toString('base64')}`
  )) as T
}
