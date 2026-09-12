/**
 * Remy Reminders — E2E Runner Executable Wrapper
 * Enables running: node tests/e2e/runner.js
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const runnerTs = join(__dirname, 'runner.ts');

const child = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', runnerTs], {
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
