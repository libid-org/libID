/// @libid/popup — one popup browsing context and its logical connection.
/// The Service Worker handler lives behind `@libid/popup/worker`.

export {
  type AcceptOptions,
  type ConnectionEnd,
  type ConnectOptions,
  PopupConnection,
} from './connection.js'
export { type PopupDiagnostic, PopupError, type PopupErrorCode } from './diagnostics.js'
export {
  type Carrier,
  type CarrierConstructor,
  type Message,
  type MessageType,
  type NavigationCarrier,
  onReplacement,
  prepareNavigation,
} from './message.js'
export { PopupWindow } from './window.js'
