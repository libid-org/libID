import type { CeremonyEvent } from '../src/ccdp/client/index.js'
import type { IdentityResult } from '../src/index.js'

declare global {
  interface Window {
    failureCode?: import('../src/errors.js').FailureCode
    ready: boolean
    completed: IdentityResult<'google'>[]
    testProgress: { update(value: number, label: string): void; stop(): void }
    result: IdentityResult<'google'> | { status: 'failed' } | undefined
    events: CeremonyEvent[]
    ceremonyClosed: unknown
    afterReady: boolean
    after(): Promise<void>
    proveFixture(platform: 'google' | 'bearer'): Promise<{
      proof: number[]
      publicInputs: string[]
      runtime: { effectiveThreads: number; sharedMemory: boolean }
    }>
    notarySmoke(
      count?: number,
      notaryAddress?: string,
    ): Promise<{ sent: number; received: number; attestedData: number }[]>
  }
}
