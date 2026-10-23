// The live run's time budgets, in milliseconds: the config, the spec and the
// popup driver take them from here, and settings.test.ts checks the CI step
// timeouts against them.

/** Starting the stack and the app (webServer). */
export const STACK_START = 10 * 60_000
/** Stopping them (webServer's graceful shutdown). */
export const STACK_STOP = 2 * 60_000
/** A page load. */
export const NAVIGATION = 60_000
/** One action, such as the click that opens the popup. */
export const ACTION = 30_000
/** The app's cold start to Ready. */
export const READY = 60_000
/** The popup driver, sign-in to the platform's return. */
export const DRIVER = 180_000
/** Proving in the browser, after the platform returns the popup. */
export const OUTCOME = 8 * 60_000

/** The bounded steps one test performs, in order: 15 minutes in all. */
export const TEST_STEPS = [
  NAVIGATION, // the app's page load
  READY,
  ACTION, // the launch click
  ACTION, // the popup's appearance
  ACTION, // the run's id from its row
  DRIVER,
  OUTCOME,
  ACTION, // the row's message
]

/** One test: its steps, with margin. */
export const TEST = 16 * 60_000
