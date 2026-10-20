import { archive, headers } from '../../../assets/index.js'

const release = archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.7.1/libid-circuits-0.7.1-bearer-link.tar.gz',
  'circuits/v0.7.1/bearer-link',
  'sha256:5818cbe534806303d2fbe2eabc6e6d9fd210529a007b899d67bbf9a1318a48cb',
)

export const circuit = release.member('bearer_link.json', {
  ...headers.immutable,
  ...headers.json,
})

export const verificationKey = release.member('vk', headers.immutable)
