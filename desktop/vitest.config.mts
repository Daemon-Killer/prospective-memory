import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
