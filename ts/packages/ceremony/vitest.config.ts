import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@libid/ledger': fileURLToPath(new URL('../ledger/src/testing.ts', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'dev/**/*.test.ts'],
  },
})
