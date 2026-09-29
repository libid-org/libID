import { MAX_NAVIGATION_FRAGMENT_CHARS } from '../src/ccdp/limits.ts'
import { messages } from '../src/ccdp/ui-messages.ts'

// A document hands its launch fragment to the bundled entry through one window property: an
// inline classic script captures it before any module runs, and the entry consumes it once.
const property = '__libidCeremonyInput'

/** Clear the document URL, refuse any query, other path or oversized fragment, keep the fragment. */
export const captureInput = (path: string) =>
  `(()=>{const query=location.search,fragment=location.hash,path=location.pathname;history.replaceState(null,'',path);if(query||path!==${JSON.stringify(path)}||fragment.length>${MAX_NAVIGATION_FRAGMENT_CHARS}){document.getElementById('libid-root').textContent=${JSON.stringify(messages.returnToApplication(messages.unableToContinue))};return}Object.defineProperty(window,'${property}',{value:fragment,configurable:true})})()`

/** Pass the captured fragment to `invoke` once; a Worker realm has no window and no input. */
export const consumeInput = (invoke: string) =>
  `if(typeof window!=='undefined'&&Object.hasOwn(window,'${property}')){const fragment=window.${property};delete window.${property};void ${invoke}(fragment)}`
