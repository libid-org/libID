import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const testing = (file: string) => fileURLToPath(new URL(`src/testing/${file}`, import.meta.url))

export default defineConfig({
  // Build-generated modules resolve to default stubs; a test mocks one only to supply entries.
  resolve: {
    alias: {
      'virtual:ceremony-assets': testing('virtual/assets.ts'),
      'virtual:ceremony-worker': testing('virtual/worker.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/testing/**',
        'src/platforms/conformance/**',
        'src/**/fixtures/**',
        'src/**/*.d.ts',
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      // The measured floor; raise it as coverage rises.
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 94 },
    },
  },
})
