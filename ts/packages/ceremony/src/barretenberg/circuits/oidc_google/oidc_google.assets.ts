import * as assets from '../../../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.7.1/libid-circuits-0.7.1-oidc-google.tar.gz',
  'circuits/v0.7.1/oidc-google',
  'sha256:7d48f20170daa0be1fc68216f31a4fe828f23dc293c8de9fd6fe8412898d134a',
)

export const circuit = release.member('oidc_google.json', {
  ...assets.headers.immutable,
  ...assets.headers.json,
})

export const verificationKey = release.member('vk', assets.headers.immutable)
