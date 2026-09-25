import { mainnet, testnet } from '@libid/ledger/testing'
import { type Message, type PopupConnection, PopupWindow } from '@libid/popup'
import { CeremonyError, createCCDPClient } from '../src/ccdp/client/index.js'

const bridge = `${location.protocol}//localhost:${Number(location.port) + 1}`,
  ccdp = `${location.protocol}//localhost:${Number(location.port) + 2}`

const client = await createCCDPClient({ oauthBridge: bridge })

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
  const id = crypto.randomUUID()
  activeId = id
  anchor.target = `ceremony-${id}`
  const popup = PopupWindow.open(anchor.target, 'width=480,height=720')
  connection = client.connect(popup, {
    connectionId: id,
    onDiagnostic: ({ code }) => run.diagnostics.push(code),
  })
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
    id,
    'google',
    new URL(location.href).searchParams.get('ledger') === 'test:mainnet' ? mainnet : testnet,
    new Uint8Array(32),
    new Uint8Array([1]),
  )
  anchor.href = ceremony.launchUrl
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
      })
    })
  if (popup.opened) event.preventDefault()
})
