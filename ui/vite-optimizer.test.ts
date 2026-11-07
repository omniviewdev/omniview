import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'vitest';

const execFileAsync = promisify(execFile);

test('Vite optimizer handles dependencies discovered before initialization', async () => {
  await execFileAsync(process.execPath, ['--test', 'scripts/vite-optimizer.test.mjs'], { timeout: 25_000 });
}, 30_000);
