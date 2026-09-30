export const CEREMONY_ID = '6e171568-54e1-4f0d-aeb5-e8859826476a'

export const utf8 = (value: string) => new TextEncoder().encode(value)

export const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
