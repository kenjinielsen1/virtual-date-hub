import { defineConfig } from 'vitest/config'

// Standalone test config so vitest doesn't load the PWA/build plugins.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
