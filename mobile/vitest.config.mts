import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the pure logic is covered here. Rendering React Native components
    // needs a device or a simulator, which no runner provides.
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
});
