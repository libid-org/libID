// The documents' UI double. Like @libid/popup/testing, it stays framework-agnostic: methods are
// own properties, so tests wrap them with their runner's spies.

import type { DocumentView, ShellView } from '../ccdp/documents/ui.js'
import type { CeremonyEvent, EventFeed } from '../events.js'

/**
 * Stand-in for the documents' `./ui.js`. It records the titles and shell failures shown and every
 * update on the document's event feed, and is itself the handle `eventView` returns.
 */
export interface FakeDocumentUi extends DocumentView {
  readonly views: string[]
  readonly failures: string[]
  readonly events: CeremonyEvent[]
  view(title: string): void
  adoptShell(title: string): Pick<ShellView, 'message' | 'fail'>
  eventView(events: EventFeed): DocumentView
}

export function fakeDocumentUi(): FakeDocumentUi {
  const ui: FakeDocumentUi = {
    views: [],
    failures: [],
    events: [],
    view: (title) => {
      ui.views.push(title)
    },
    adoptShell: () => ({
      message: (text) => ui.message(text),
      fail: (text) => {
        ui.failures.push(text)
      },
    }),
    eventView: (events) => {
      events.onEvent((event) => ui.events.push(event))
      return ui
    },
    stop: () => {},
    message: () => {},
    trackProof: () => {},
    finishProof: async () => {},
    delivered: () => {},
  }
  return ui
}

/**
 * The `./ui.js` module over whichever double `current` returns when a document calls it, so a
 * hoisted `vi.mock` factory can serve a double the test creates later.
 */
export const documentUi = (current: () => FakeDocumentUi) => ({
  view: (title: string) => current().view(title),
  adoptShell: (title: string) => current().adoptShell(title),
  eventView: (events: EventFeed) => current().eventView(events),
})
