import { findUnique, quotedRange, decodePrintable } from '../../../prover/transcript.js'
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
        'User-Agent': 'libid-ceremony',
        Connection: 'close',
      }).map(([k, v]) => [k, encoder.encode(v)]),
    ),
  }
}
export function selectIdentity(transcript: Transcript, bearer: string) {
  const request = identityRequest(bearer),
    text = new TextDecoder('utf-8', { fatal: true }).decode(transcript.sent)
  const [line, ...headers] = text.split('\r\n')
  if (line !== 'GET /user HTTP/1.1' || headers.splice(-2).join('|') !== '|')
    throw new Error('Invalid identity request framing')
  const expected = new Map(
    Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), new TextDecoder().decode(v)]),
  )
  let offset = line.length + 2,
    start = -1
  for (const header of headers) {
    const i = header.indexOf(': '),
      key = header.slice(0, i).toLowerCase()
    if (i < 0 || expected.get(key) !== header.slice(i + 2))
      throw new Error('Invalid identity header')
    expected.delete(key)
    if (key === 'authorization') start = offset + i + 2 + 'Bearer '.length
    offset += header.length + 2
  }
  if (expected.size || start < 0) throw new Error('Missing identity header')
  const prefix = encoder.encode('"id":'),
    idStart = findUnique(transcript.received, prefix, 'identity id'),
    valueStart = idStart + prefix.length
  let end = valueStart
  while (transcript.received[end] >= 48 && transcript.received[end] <= 57) end++
  const userId = new TextDecoder().decode(transcript.received.slice(valueStart, end))
  if (
    !/^[1-9][0-9]{0,19}$/.test(userId) ||
    BigInt(userId) > 0xffffffffffffffffn ||
    ![44, 125].includes(transcript.received[end])
  )
    throw new Error('Invalid GitHub id')
  const login = quotedRange(transcript.received, encoder.encode('"login":"'), 'identity login'),
    userName = decodePrintable(login.value, 'identity login', 39)
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(userName) || userName.includes('--'))
    throw new Error('Invalid GitHub login')
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
