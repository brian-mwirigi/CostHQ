import { defineConfig } from 'vitest/config';
import { join } from 'path';
import { tmpdir } from 'os';

export default defineConfig({
  test: {
    globals: true,
    env: {
      CODESESSION_DATA_DIR: join(tmpdir(), `cs-test-${Date.now()}`),
    },
    fileParallelism: false,
    testTimeout: 15000,
    include: ['tests/**/*.test.ts'],
  },
});
