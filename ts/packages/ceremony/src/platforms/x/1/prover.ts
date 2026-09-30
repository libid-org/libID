import { proveBearerLink } from '../../../barretenberg/circuits/bearer-link/prover.js'
import type { ProverContext } from '../../context.js'
import { acceptReturn } from '../../oauthReturn.js'
import * as transcript from './transcript.js'

export async function prove(context: ProverContext) {
  const code = acceptReturn(context, 'x')
  return code === null ? null : proveBearerLink(context, 'x', transcript, code)
}
