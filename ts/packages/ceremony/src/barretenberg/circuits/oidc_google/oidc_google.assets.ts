import * as assets from '../../../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.6.0/libid-circuits-0.6.0-oidc-google.tar.gz',
  'circuits/v0.6.0/oidc-google',
  'sha256:0ca014b0834273d3bfc50d1dac94d46d51e009d620aba4cc8c45529aefa483ee',
)

export const circuit = release.member('oidc_google.json', {
  ...assets.headers.immutable,
  ...assets.headers.json,
})

export const verificationKey = release.member('vk', assets.headers.immutable)
