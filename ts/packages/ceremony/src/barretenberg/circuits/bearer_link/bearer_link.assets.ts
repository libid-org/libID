import * as assets from '../../../assets/index.js'

export const bearerRelease = assets.archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.3.0/libid-circuits-0.3.0-bearer-link.tar.gz',
  'circuits/v0.3.0/bearer-link',
)

export const bearerVerificationKey = bearerRelease.member('vk', assets.headers.immutable)

export const bearerCircuit = bearerRelease.member('bearer_link.json', {
  ...assets.headers.immutable,
  ...assets.headers.json,
})
