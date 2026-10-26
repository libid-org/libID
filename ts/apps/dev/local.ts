// The origins the app, services.ts and the tests share. compose.yaml and
// bridge-config.toml repeat the ports they need.

export const APP_PORT = 4691
/** The app, served by Vite; bridge-config.toml admits this origin. */
export const APP_ORIGIN = `http://localhost:${APP_PORT}`
export const BRIDGE = 'http://localhost:4682'
/** Bridge's configuration document, which answers once Bridge is ready. */
export const BRIDGE_CONFIG = `${BRIDGE}/api/v1/ceremony/config`
export const NOTARY = 'http://localhost:4687'
