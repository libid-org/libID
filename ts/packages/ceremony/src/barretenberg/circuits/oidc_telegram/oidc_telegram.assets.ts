import * as assets from '../../../assets/index.js'
import { srs } from '../../barretenberg.assets.js'
import { SRS_POINTS } from './parameters.js'

const release = assets.archive(
  'https://github.com/libid-org/libid-circuits/releases/download/v0.9.0/libid-circuits-0.9.0-oidc-telegram.tar.gz',
  'circuits/v0.9.0/oidc-telegram',
  'sha256:4c1ea1fd5dace0f13c1a1489d1274955c77c7f5da99edde0f0e000ae198143f9',
)

export const circuit = release.member('oidc_telegram.json', {
  ...assets.headers.immutable,
  ...assets.headers.json,
})

export const verificationKey = release.member('vk', assets.headers.immutable)

export const crs = srs(SRS_POINTS)
