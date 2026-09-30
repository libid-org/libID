import * as assets from '../../../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.5.0/libid-circuits-0.5.0-oidc-google.tar.gz',
  'circuits/v0.5.0/oidc-google',
  'sha256:5c0e2a8e3239f2aaa1132e4cf9ec571c77c3148434bfc182a69c61492ff38630',
)

export const circuit = release.member('oidc_google.json', {
  ...assets.headers.immutable,
  ...assets.headers.json,
})

export const verificationKey = release.member('vk', assets.headers.immutable)
