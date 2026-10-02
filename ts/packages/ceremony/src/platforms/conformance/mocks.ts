// The conformance suites' doubles. Only the external TLSN runtime and the expensive proof
// engine are replaced, and each resource gets one distinct URL, so tests can see which
// resources a prover proves with.
import { type Mock, vi } from 'vitest'
import type { ProofEngineOptions } from '../../barretenberg/engine.js'

export const prepare: Mock = vi.fn()
export const generate: Mock = vi.fn()
export const destroy: Mock = vi.fn()
export const engine: Mock = vi.fn()
/** A ProofEngine's `outcome`; it stays pending unless a test fails the backend. */
export const engineOutcome = vi.fn<() => Promise<void> | undefined>()
export const notarization: Mock = vi.fn()

export function assetsModule<M extends object>(original: M) {
  const urls = new Map<object, string>()
  return {
    ...original,
    assetUrl: (asset: object) => {
      if (!urls.has(asset)) urls.set(asset, `https://ccdp.test/asset/${urls.size}`)
      return urls.get(asset)
    },
  }
}

export const engineModule = {
  ProofEngine: class {
    constructor(options: ProofEngineOptions) {
      engine(options)
      options.emit?.({ event: 'zk-proof-preparation', phase: 'started', timestamp: 0 })
    }
    outcome = engineOutcome() ?? new Promise<void>(() => {})
    prove = generate
    destroy = destroy
  },
}

export const sessionModule = {
  NotaryRuntime: class {
    constructor(address: string, signal: AbortSignal, emit: unknown) {
      notarization(address, signal, emit)
      signal.throwIfAborted()
    }
    prepare = prepare
  },
}
