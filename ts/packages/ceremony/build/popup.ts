// Code-owned integration point for the optional carrier supplied by the application too.
// A released adapter may provide `fallback`; its implementation belongs outside ceremony.
export const popupFallback: {
  readonly module?: string
  readonly connectSources: readonly string[]
} = { connectSources: [] }
