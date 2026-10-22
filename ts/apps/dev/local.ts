// The origins the app, services.ts and the tests share. compose.yaml and
// bridge-config.toml repeat them; services.ts and local.test.ts check both.

/** The app, served by Vite; bridge-config.toml admits this origin. */
export const APP_ORIGIN = 'http://localhost:4691'
export const BRIDGE = 'http://localhost:4682'
export const NOTARY = 'http://localhost:4687'
