import { isUserId } from '../../types.js'
import { isUserName } from './types.js'
import {
  findUnique,
  quotedRange,
  decodePrintable,
  identityBearerRange,
} from '../../../prover/transcript.js'
import type { Transcript, ExactHttpRequest } from '../../../prover/notarization/session.js'
const encoder = new TextEncoder()
export function identityRequest(bearer: string): ExactHttpRequest {
  if (!/^[\x21-\x7e]{1,128}$/.test(bearer)) throw new Error('Invalid bearer')
  return {
    url: 'https://api.github.com/user',
    method: 'GET',
    body: new Uint8Array(),
    headers: Object.fromEntries(
      Object.entries({
        Host: 'api.github.com',
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': navigator.userAgent,
        'X-GitHub-Api-Version': '2022-11-28',
        Connection: 'close',
      }).map(([k, v]) => [k, encoder.encode(v)]),
    ),
  }
}
export function selectIdentity(transcript: Transcript, bearer: string) {
  const { start } = identityBearerRange(
    transcript.sent,
    'GET /user HTTP/1.1',
    identityRequest(bearer).headers,
    bearer,
  )
  const prefix = encoder.encode('"id":'),
    idStart = findUnique(transcript.received, prefix, 'identity id'),
    valueStart = idStart + prefix.length
  let end = valueStart
  while (transcript.received[end] >= 48 && transcript.received[end] <= 57) end++
  const userId = new TextDecoder().decode(transcript.received.slice(valueStart, end))
  if (!isUserId(userId) || ![44, 125].includes(transcript.received[end]))
    throw new Error('Invalid GitHub id')
  const login = quotedRange(transcript.received, encoder.encode('"login":"'), 'identity login'),
    userName = decodePrintable(login.value, 'identity login', 39)
  if (!isUserName(userName)) throw new Error('Invalid GitHub login')
  return {
    userId,
    userName,
    ranges: {
      sent: [
        { start: 0, end: start },
        { start: start + bearer.length, end: transcript.sent.length },
      ],
      received: [{ start: idStart, end: end + 1 }, login.range].sort((a, b) => a.start - b.start),
    },
    bearerRange: { start, end: start + bearer.length },
  }
}
