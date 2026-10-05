/** Transcript acceptance ceilings, also supplied to TLSN setup (not receive-time memory caps). */
export const MAX_SENT_BYTES = 4 * 1024
export const MAX_RECV_BYTES = 32 * 1024

/** Original binary signed data; separate from the JSON byte-array transport envelope. */
export const MAX_ATTESTED_DATA_BYTES = 2 * 1024 * 1024
export const MAX_FRAME_BYTES = 10 * 1024 * 1024
