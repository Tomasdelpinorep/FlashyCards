import { defineConfig } from 'vitest/config'

// Worker tests run in plain Node against the Hono app (see docs/DECISIONS.md).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
