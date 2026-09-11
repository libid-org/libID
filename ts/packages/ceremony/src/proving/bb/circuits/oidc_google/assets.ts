import * as resource from '../../../../assets.js'
export const release = resource.archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.3.0/libid-circuits-0.3.0-oidc-google.tar.gz',
  'circuits/v0.3.0/oidc-google',
)
export const circuit = release.member('oidc_google.json', {
  ...resource.headers.immutable,
  ...resource.headers.json,
})
export const verificationKey = release.member('vk', resource.headers.immutable)
