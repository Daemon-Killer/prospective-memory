import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Shared pure parsers live under the mobile folder; tests use desktop TS
  // settings so a clean desktop build does not require Expo dependencies.
  tsconfig: resolve(import.meta.dirname, 'tsconfig.json'),
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@core': resolve(import.meta.dirname, '../reminder app/src/utils'),
      '@types-remy': resolve(import.meta.dirname, '../reminder app/src/types'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
