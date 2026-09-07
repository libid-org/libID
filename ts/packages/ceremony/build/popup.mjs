// Code-owned integration point for the optional carrier supplied by the application too.
// A released adapter may provide `fallback`; its implementation belongs outside ceremony.
export const popupFallback = { module: undefined, connectSources: [] }
export function popupPlugin() {
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
