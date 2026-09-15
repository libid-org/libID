import type { CeremonyEvent } from '../src/ccdp/client/index.js'
import type { Events } from '../src/events.js'
import type { IdentityResult } from '../src/index.js'

declare global {
  interface Window {
    failureEvent?: string
    ready: boolean
    completed: IdentityResult<'google'>[]
    runs: { events: CeremonyEvent[]; diagnostics: string[]; outcome?: string; closed?: unknown }[]
    testEvents: Events
    testView: {
      trackProof(weights: Readonly<Record<string, number>>): void
      finishProof(): Promise<void>
      delivered(): void
      stop(): void
    }
    result: IdentityResult<'google'> | { status: 'failed' } | undefined
    events: CeremonyEvent[]
    ceremonyClosed: unknown
    afterReady: boolean
    after(): Promise<void>
    proveBearerFixture(): Promise<{
      proof: number[]
      publicInputs: string[]
      runtime: { effectiveThreads: number; sharedMemory: boolean }
    }>
    notarizeRequests(
      count: number,
      platform?: 'x' | 'github',
    ): Promise<{ sent: number; received: number; attestedData: number }[]>
  }
}
