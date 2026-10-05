import type { ProverContext } from '../../context.js'
import { proveNotarized } from '../../notarized/prover.js'
import { identity } from './identity.js'
import { token } from './token.js'

export const prove = (context: ProverContext<'x'>) =>
  proveNotarized(context, 'x', { token, identity })
