import { proveBearerLink } from '../../../barretenberg/circuits/bearer-link/prover.js'
import type { ProverContext } from '../../context.js'
import * as exchange from './exchange.js'

export const prove = (context: ProverContext<'github'>) =>
  proveBearerLink(context, 'github', exchange)
