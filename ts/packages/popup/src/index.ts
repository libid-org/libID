/// @libid/popup — one popup browsing context and its logical connection.
/// The Service Worker handler lives behind `@libid/popup/worker`.

export {
  type AcceptOptions,
  type ConnectOptions,
  PopupConnection,
} from './connection.js'
export type { PopupDiagnostic } from './diagnostics.js'
export type { Carrier, CarrierConstructor, Message, MessageType } from './message.js'
export { PopupWindow } from './window.js'
