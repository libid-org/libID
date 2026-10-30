import * as assets from '../../../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.9.0/libid-circuits-0.9.0-oidc-telegram.tar.gz',
  'circuits/v0.9.0/oidc-telegram',
  'sha256:f2144fc4f41c0a06a9e446144048688c5bb08ba035f3d082e11f8882917560a9',
)

export const circuit = release.member('oidc_telegram.json', {
  ...assets.headers.immutable,
  ...assets.headers.json,
})

export const verificationKey = release.member('vk', assets.headers.immutable)
