import { archive, headers } from '../../../assets/index.js'

const release = archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.6.0/libid-circuits-0.6.0-bearer-link.tar.gz',
  'circuits/v0.6.0/bearer-link',
  'sha256:84831e14d52c9ff1b5a9c4e9a5d79b9849370ed08b64b8966439e7c73d7e61c7',
)

export const circuit = release.member('bearer_link.json', {
  ...headers.immutable,
  ...headers.json,
})

export const verificationKey = release.member('vk', headers.immutable)
