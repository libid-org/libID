import type { CeremonyEvent } from '../src/client/index.js'
import type { IdentityResult } from '../src/index.js'
declare global {
  interface Window {
    ready: boolean
    completed: IdentityResult[]
    testProgress: { update(value: number, label: string): void; stop(): void }
    result: IdentityResult | { status: 'failed' } | undefined
    events: CeremonyEvent[]
    ceremonyClosed: unknown
    afterReady: boolean
    after(): Promise<void>
    proveFixture(platform: 'google' | 'bearer'): Promise<{
      proof: number[]
      publicInputs: string[]
      runtime: { effectiveThreads: number; sharedMemory: boolean }
    }>
    notarySmoke(count?: number): Promise<{ sent: number; received: number; attestedData: number }[]>
  }
}
