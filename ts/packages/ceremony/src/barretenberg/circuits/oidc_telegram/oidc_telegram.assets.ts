import * as assets from '../../../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.9.0/libid-circuits-0.9.0-oidc-telegram.tar.gz',
  'circuits/v0.9.0/oidc-telegram',
  'sha256:1818bc19946fee6b607a05fb067562d042315a835ba16c684f039d55a047c833',
)

export const circuit = release.member('oidc_telegram.json', {
  ...assets.headers.immutable,
  ...assets.headers.json,
})

export const verificationKey = release.member('vk', assets.headers.immutable)
