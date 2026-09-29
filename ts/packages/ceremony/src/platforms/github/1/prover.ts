import { proveBearerLink } from '../../bearer-link/prover.js'
import type { ProverContext } from '../../context.js'
import { acceptReturn } from '../../oauthReturn.js'
import * as transcript from './transcript.js'

export async function prove(context: ProverContext) {
  const code = acceptReturn(context, 'github')
  return code === null ? null : proveBearerLink(context, 'github', transcript, code)
}
