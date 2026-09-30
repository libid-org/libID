import { archive, headers } from '../../../assets/index.js'
import { notaryAssets } from '../../../notary/notary.assets.js'
import { proofAssets } from '../../barretenberg.assets.js'

const release = archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.5.0/libid-circuits-0.5.0-bearer-link.tar.gz',
  'circuits/v0.5.0/bearer-link',
  'sha256:4ca300978717df3cbfd1038e4f6d7cd51c3bf12f881e1ff78e17581455a7bdf4',
)

export const circuit = release.member('bearer_link.json', {
  ...headers.immutable,
  ...headers.json,
})

export const verificationKey = release.member('vk', headers.immutable)

/** Every X/GitHub v1 resource: the proof engine, the notary client and this circuit. */
export const bearerLinkAssets = [...proofAssets, ...notaryAssets, circuit, verificationKey] as const
