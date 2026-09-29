// Shared ceremony test values and byte helpers, maintained here instead of redefined per test.
// Connection and browser doubles live in @libid/popup/testing.

export const CEREMONY_ID = '6e171568-54e1-4f0d-aeb5-e8859826476a'

export const utf8 = (value: string) => new TextEncoder().encode(value)

export const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

export * from './ccdp.js'
export * from './http.js'
