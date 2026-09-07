import { PopupConnection, PopupWindow, type Message } from '@libid/popup'
import { createCeremonyClient } from '../src/client/index.js'
const bridge = 'https://localhost:4682',
  ccdp = 'https://localhost:4683'
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
  const ceremony = client.new(id, {
    connection,
    chainId: new Uint8Array(32),
    operationDomain: new Uint8Array(32),
    transactionData: new Uint8Array([1]),
    platformId: 'google',
  })
  anchor.href = ceremony.launchUrl
  Object.assign(window, { cancel: () => ceremony.cancel(), ceremony })
  ceremony.onEvent((event) => (window as unknown as { events: unknown[] }).events.push(event))
  void ceremony
    .proveUserIdentity()
    .then((result) => {
      window.completed.push(result)
      Object.assign(window, { result })
    })
    .catch(() => Object.assign(window, { result: { status: 'failed' } }))
  if (popup.opened) event.preventDefault()
})
