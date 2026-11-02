import { PLATFORM_GITHUB_KEY } from '@libid/contracts/platforms'
import type { ProverContext } from '../../context.js'
import { proveNotarized } from '../../notarized/prover.js'
import { identity } from './identity.js'
import { token } from './token.js'

export const prove = (context: ProverContext<'github'>) =>
  proveNotarized(context, PLATFORM_GITHUB_KEY, { token, identity })
