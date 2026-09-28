// The popup origin's Service Worker script for the e2e server: exactly what
// a host composes, and nothing else.
import { installPortKeeper } from '../src/worker.js'

installPortKeeper()
