import * as assets from '../../../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.8.0/libid-circuits-0.8.0-oidc-google.tar.gz',
  'circuits/v0.8.0/oidc-google',
  'sha256:13a512f77fffe2d880cd3f300c22107a3dbe4add31a7fb3235d78824a2cd70b7',
)

export const circuit = release.member('oidc_google.json', {
  ...assets.headers.immutable,
  ...assets.headers.json,
})

export const verificationKey = release.member('vk', assets.headers.immutable)
