import type { ProverContext } from '../../context.js'
import { proveNotarized } from '../../notarized/prover.js'
import { identity } from './identity.js'
import { token } from './token.js'

export const prove = (context: ProverContext<'github'>) =>
  proveNotarized(context, 'github', { token, identity })
