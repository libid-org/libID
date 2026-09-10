import { mainnet, testnet } from '@libid/ledger/testing'
import { PopupConnection, PopupWindow, type Message } from '@libid/popup'
import { CeremonyError, createCeremonyClient } from '../src/client/index.js'
const bridge = `${location.protocol}//localhost:${Number(location.port) + 1}`,
  ccdp = `${location.protocol}//localhost:${Number(location.port) + 2}`
const client = await createCeremonyClient({ oauthBridge: bridge })
let activeId = ''
const anchor = document.querySelector<HTMLAnchorElement>('#launch')!
let connection: PopupConnection<Message> | undefined
Object.assign(window, {
  ready: true,
  result: undefined,
  events: [],
  completed: [],
  ceremonyClosed: undefined,
  async after() {
    await connection!.navigate(`${ccdp}/after`, new URLSearchParams({ id: activeId }))
  },
})
anchor.addEventListener('click', (event) => {
  const id = crypto.randomUUID()
  activeId = id
  anchor.target = `ceremony-${id}`
  const popup = PopupWindow.open(anchor.target, 'width=480,height=720')
  connection = PopupConnection.connect(popup, {
    connectionId: id,
    allowedPopupOrigins: [bridge, ccdp],
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
  connection.closed.then((closed) => Object.assign(window, { ceremonyClosed: closed }))
  const ceremony = client.new(
    connection,
    id,
    new URL(location.href).searchParams.get('ledger') === 'test:mainnet' ? mainnet : testnet,
    'google',
    new Uint8Array(32),
    new Uint8Array([1]),
  )
  anchor.href = ceremony.launchUrl
  Object.assign(window, { cancel: () => ceremony.cancel(), ceremony })
  ceremony.onEvent((event) => (window as unknown as { events: unknown[] }).events.push(event))
  void ceremony
    .proveUserIdentity()
    .then((result) => {
      window.completed.push(result)
      Object.assign(window, { result })
    })
    .catch((error: unknown) =>
      Object.assign(window, {
        result: { status: 'failed' },
        failureCode: error instanceof CeremonyError ? error.code : undefined,
      }),
    )
  if (popup.opened) event.preventDefault()
})
