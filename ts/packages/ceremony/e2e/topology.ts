// Dedicated test ports, separate from the shared development app; compose.yaml publishes the
// container ports. Harness code and tests derive every origin from here.

/** SWS serving the qualification artifact behind the CCDP origins. */
export const sws = 4980

/** SWS serving the runtime qualification page. */
export const runtime = 4986

/** The pinned notary. */
export const notary = 4987

/** Application, Bridge and CCDP origins, on consecutive ports per scheme. */
export function origins(secure: boolean) {
  const scheme = secure ? 'https' : 'http',
    port = secure ? 4881 : 4781
  return {
    app: `${scheme}://localhost:${port}`,
    bridge: `${scheme}://localhost:${port + 1}`,
    ccdp: `${scheme}://localhost:${port + 2}`,
  }
}
