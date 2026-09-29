// CCDP request builders and the documents' UI double. Like @libid/popup/testing, they stay
// framework-agnostic: methods are own properties, so tests wrap them with their runner's spies.

import type { eventView } from '../ccdp/documents/ui.js'
import type { CeremonyEvent, Events } from '../events.js'

type DocumentView = ReturnType<typeof eventView>

/**
 * Stand-in for the documents' `./ui.js`. It records the titles shown and every update on the
 * document's event feed, and is itself the handle `eventView` returns.
 */
export interface FakeDocumentUi extends DocumentView {
  readonly views: string[]
  readonly events: CeremonyEvent[]
  view(title: string): void
  eventView(events: Events): DocumentView
}

export function fakeDocumentUi(): FakeDocumentUi {
  const ui: FakeDocumentUi = {
    views: [],
    events: [],
    view: (title) => {
      ui.views.push(title)
    },
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
  eventView: (events: Events) => current().eventView(events),
})
