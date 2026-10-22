// The origins the app, services.ts and the live tests share. compose.yaml and
// bridge-config.toml repeat the ports they need.

/** The app, served by Vite; bridge-config.toml admits this origin. */
export const APP_ORIGIN = 'http://localhost:4691'
export const BRIDGE = 'http://localhost:4682'
