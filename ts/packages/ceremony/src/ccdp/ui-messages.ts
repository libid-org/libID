import type { PopupErrorCode } from '@libid/popup'

/** Package-owned CCDP display text, shared by documents and the client stage projection. */
export const messages = {
  brand: 'libID',
  preparation: 'Preparing your ceremony',
  authorization: (platform: string) => `Authorize with ${platform}`,
  proofPreparation: 'Preparing your identity proof',
  notarization: 'Notarizing your identity data',
  zkProving: 'Creating your identity proof with ZK',
  progress: 'Ceremony in progress',
  slowProving: 'Still proving. In Vanadium, enabling JavaScript JIT in site controls may help.',
  proofReceived: 'Proof received',
  proofDelivered: 'Proof delivered.',
  authorizationDeclined: 'Authorization declined.',
  interrupted: 'Ceremony interrupted.',
  failed: 'Ceremony failed.',
  returning: 'Returning to your application',
  returnToApplication: (message: string) => `${message} Return to your application.`,
  unsupportedVersion:
    'This ceremony version is no longer supported. Update the application and try again.',
  unableToContinue: 'Unable to continue.',
  notFoundTitle: 'Not found',
  notFound: 'Not found.',
  missingRoot: 'Missing ceremony root',
  oauthReturnTooLarge: 'OAuth return too large',
  invalidOAuthState: 'Invalid OAuth state',
  invalidCallbackInputs: 'Invalid Callback inputs',
  missingApplicationOrigin: 'Authenticated Application origin unavailable',
  callbackClosed: 'Callback connection closed',
  proverClosed: 'Prover connection closed',
  connectionEnded: 'Popup connection ended',
  connectionInitializationFailed: 'Unable to initialize ceremony connection',
  invalidProvingRequest: 'Invalid proving request',
  isolationUnavailable: 'Prover isolation unavailable',
  unsupportedProfile: 'Unsupported profile',
} as const

/** Translate transport codes here; popup owns codes, CCDP owns their presentation. */
export const popupErrorMessages = {
  'popup-unavailable':
    'Popup is unavailable. It may have been closed or isolated by the provider (COOP). If you did not close it, the popup connection was lost.',
  'fallback-unavailable':
    'Unable to reconnect to the application. The sign-in provider may have isolated this window, preventing the ceremony from continuing.',
  'fallback-failed': 'This popup could not establish a fallback connection to the application.',
  'handshake-rejected':
    'The popup connection failed authentication. Check the application and popup origins and connection configuration.',
  'opener-timeout': 'The application did not respond to the popup connection request.',
  'decode-rejected': 'The popup connection received an invalid message.',
  'control-rejected': 'The popup connection received an invalid control message.',
  'continuity-unsupported': 'This browser cannot preserve the popup connection across navigation.',
  'keep-failed': 'Unable to preserve the popup connection before navigation.',
  'claim-failed': 'Unable to restore the popup connection after navigation.',
  'isolation-unavailable': 'The browser isolation required for proving is unavailable.',
  'send-unavailable': 'Unable to send a message because the popup connection is unavailable.',
  'connection-closed': messages.connectionEnded,
} satisfies Record<PopupErrorCode, string>
