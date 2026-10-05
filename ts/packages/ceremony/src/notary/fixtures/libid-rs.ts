import { readFileSync } from 'node:fs'

/**
 * Attested-data bytes from libid-org/libid-rs@239a4bb426ac72591fe30006f22660e164a98d96,
 * crates/libid-ceremony/src/attestation.rs::CROSS_LANGUAGE_FIXTURE. Copy before mutating.
 */
export const LIBID_RS_ATTESTED_DATA = Uint8Array.from(
  Buffer.from(
    readFileSync(
      new URL('../libid-rs-239a4bb-attested-data.fixture.hex', import.meta.url),
      'utf8',
    ).trim(),
    'hex',
  ),
)
