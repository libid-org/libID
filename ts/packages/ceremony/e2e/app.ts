import { type Message, type PopupConnection, PopupWindow } from '@libid/popup'
import { CeremonyError, createCCDPClient, supportedPlatforms } from '../src/index.js'
import { mainnet, testnet } from '../src/testing/ledgers.ts'
import { origins } from './topology.js'

const { bridge, ccdp } = origins(location.protocol === 'https:')

const client = await createCCDPClient({ oauthBridge: bridge })
const platform =
  supportedPlatforms.find((id) => id === new URL(location.href).searchParams.get('platform')) ??
  'google'

let activeId = ''

const anchor = document.querySelector<HTMLAnchorElement>('#launch')!

let connection: PopupConnection<Message> | undefined

Object.assign(window, {
  ready: true,
  result: undefined,
  events: [],
  completed: [],
  runs: [],
  ceremonyClosed: undefined,
  async after() {
    await connection!.navigate(`${ccdp}/after`, new URLSearchParams({ id: activeId }))
  },
})

anchor.addEventListener('click', (event) => {
  const run: Window['runs'][number] = { events: [], diagnostics: [] }
  window.runs.push(run)
  connection = client.connect(PopupWindow.fromAnchor(event, 'width=480,height=720'), {
    onDiagnostic: ({ code }) => run.diagnostics.push(code),
  })
  activeId = connection.connectionId
  connection.on(
    {
      type: 'after',
      decode(value: unknown) {
        if ((value as Message)?.type !== 'after') throw new Error()
        return value as Message
      },
    },
    () => Object.assign(window, { afterReady: true }),
  )
  connection.closed.then((closed) => {
    run.closed = closed
    Object.assign(window, { ceremonyClosed: closed })
  })
  const ceremony = client.new(
    connection,
    platform,
    new URL(location.href).searchParams.get('ledger') === 'test:mainnet' ? mainnet : testnet,
    new Uint8Array(32),
    new Uint8Array([1]),
  )
  ceremony.onEvent((event) => {
    run.events.push(event)
    window.events.push(event)
  })
  void ceremony
    .proveUserIdentity()
    .then((result) => {
      run.outcome = result.status
      window.completed.push(result)
      Object.assign(window, { result })
    })
    .catch((error: unknown) => {
      run.outcome = 'failed'
      Object.assign(window, {
        result: { status: 'failed' },
        failureEvent: error instanceof CeremonyError ? error.event : undefined,
        failureMessage: error instanceof Error ? error.message : String(error),
      })
    })
})
