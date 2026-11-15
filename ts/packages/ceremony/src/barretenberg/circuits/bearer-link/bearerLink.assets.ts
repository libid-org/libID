import { archive, headers } from '../../../assets/index.js'

const release = archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.8.0/libid-circuits-0.8.0-bearer-link.tar.gz',
  'circuits/v0.8.0/bearer-link',
  'sha256:2957ac0018b8384ca945e08b31c793b4054a03cad04d658a1ddb30ef0eadfb6d',
)

export const circuit = release.member('bearer_link.json', {
  ...headers.immutable,
  ...headers.json,
})

export const verificationKey = release.member('vk', headers.immutable)
