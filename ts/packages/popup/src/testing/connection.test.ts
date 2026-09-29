import { expect, it } from 'vitest'
import type { Message, MessageType } from '../message.js'
import { fakeConnection } from './connection.js'

interface Ping extends Message {
  type: 'ping'
  n: number
}

const Ping: MessageType<Ping> = {
  type: 'ping',
  decode: (value) => {
    const { n } = value as Ping
    if (typeof n !== 'number') throw new TypeError('Invalid ping')
    return { type: 'ping', n }
  },
}

it('records sends and navigations, and delivers decoded peer messages to one handler', async () => {
  const connection = fakeConnection<Ping>()
  const received: number[] = []
  const off = connection.on(Ping, (message) => received.push(message.n))
  expect(() => connection.on(Ping, () => {})).toThrow('already registered')
  connection.send({ type: 'ping', n: 1 })
  connection.receive({ type: 'ping', n: 2 })
  await connection.navigate('https://popup.example/next', new URLSearchParams({ a: '1' }))
  expect(connection.sent).toEqual([{ type: 'ping', n: 1 }])
  expect(received).toEqual([2])
  expect(connection.navigations).toEqual([
    { url: 'https://popup.example/next', fragment: 'a=1', away: false },
  ])
  off()
  connection.receive({ type: 'ping', n: 3 })
  expect(received).toEqual([2])
  await expect(connection.ready).resolves.toBeUndefined()
})

it('ends once, then ignores messages and refuses to navigate away', async () => {
  const connection = fakeConnection<Ping>()
  const received: number[] = []
  connection.on(Ping, (message) => received.push(message.n))
  connection.end({ outcome: 'failed', code: 'keep-failed' })
  await connection.close()
  await expect(connection.closed).resolves.toEqual({ outcome: 'failed', code: 'keep-failed' })
  connection.receive({ type: 'ping', n: 1 })
  expect(received).toEqual([])
  await expect(connection.navigateAway('https://elsewhere.example/')).rejects.toThrow('closed')
})

it('settles pending readiness when the test decides', async () => {
  const pending = fakeConnection({ ready: 'pending' })
  const failing = fakeConnection({ ready: 'pending', peerOrigin: null })
  failing.settle(new Error('no carrier'))
  pending.settle()
  await expect(pending.ready).resolves.toBeUndefined()
  await expect(failing.ready).rejects.toThrow('no carrier')
  expect(failing.peerOrigin).toBeNull()
})
