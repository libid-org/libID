import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { build, type Rollup } from 'vite'
import { assetPlugin } from './asset-plugin.ts'
import { packageDir } from './release.ts'

test('runtime lowering preserves named/chained calls and external request options [LIBID-MOD-021] [LIBID-ASSET-022]', async () => {
  const id = join(packageDir, 'src/asset-lowering-fixture.ts')
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'resource-fixture',
        resolveId: (file) => (file === id ? id : undefined),
        load: (file) =>
          file === id
            ? `
        import {archive as release,file,external,resolve,headers} from './assets.js';
        import * as assets from './assets.js';
        const a=release('https://secret-build-source.test/a.tar.gz','a/v1').member('snippets/x-*/worker.js',headers.executionWorker);
        const b=assets.archive('https://secret-build-source.test/b.tar.gz','b/v1');
        const c=file('npm:build-only/file.wasm','file/v1.wasm',headers.wasm);
        const request=external('https://CDN.test:443/g1',{range:'bytes=0-31',bytes:32,fallback:['https://fallback.test/g1']});
        export const resolved=[resolve(a),resolve(b.member('data.json',headers.json)),resolve(c),resolve(request)];
        export const options={range:request.range,bytes:request.bytes,fallback:request.fallback};
      `
            : undefined,
      },
      assetPlugin({
        urls: {
          'a/v1/snippets/x-*/worker.js': '/ccdp/assets/a/v1/snippets/x-123/worker.js',
          'b/v1/data.json': '/ccdp/assets/b/v1/data.json',
          'file/v1.wasm/': '/ccdp/assets/file/v1.wasm',
        },
        moduleUrls: {},
        requestsByProfile: {},
        allowedRequests: [],
      }),
    ],
    build: { write: false, minify: false, lib: { entry: id, formats: ['es'] } },
  })
  const code = ((Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput).output.find(
    (o) => o.type === 'chunk',
  )!.code
  assert.doesNotMatch(code, /secret-build-source|npm:build-only|Content-Security-Policy/)
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', {
    value: { origin: 'https://ccdp.test' },
    configurable: true,
  })
  try {
    const runtime = await import(
      `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    )
    assert.deepEqual(runtime.resolved, [
      'https://ccdp.test/ccdp/assets/a/v1/snippets/x-123/worker.js',
      'https://ccdp.test/ccdp/assets/b/v1/data.json',
      'https://ccdp.test/ccdp/assets/file/v1.wasm',
      'https://CDN.test:443/g1',
    ])
    assert.deepEqual(runtime.options, {
      range: 'bytes=0-31',
      bytes: 32,
      fallback: ['https://fallback.test/g1'],
    })
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor)
    else Reflect.deleteProperty(globalThis, 'location')
  }
})
