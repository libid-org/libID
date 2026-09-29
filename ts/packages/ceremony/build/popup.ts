import type { Plugin } from 'vite'

// Code-owned integration point for the optional carrier supplied by the application too.
// A released adapter may provide `fallback`; its implementation belongs outside ceremony.
export const popupFallback: {
  readonly module?: string
  readonly connectSources: readonly string[]
} = { connectSources: [] }

export function popupPlugin(): Plugin {
  return {
    name: 'ceremony-popup-fallback',
    resolveId(id) {
      if (id === 'virtual:ceremony-popup-fallback') return `\0${id}`
    },
    load(id) {
      if (id === '\0virtual:ceremony-popup-fallback')
        return popupFallback.module
          ? `export {fallback} from ${JSON.stringify(popupFallback.module)}`
          : 'export const fallback=undefined'
    },
  }
}
