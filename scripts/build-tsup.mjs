import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Resolve the same package-local CLI as pnpm's script PATH, but pass the selected
// sibling output as argv rather than shell interpolation (including on Windows).
const require = createRequire(path.join(process.cwd(), 'package.json'));
const manifestPath = require.resolve('tsup/package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.tsup;
if (typeof entry !== 'string') throw new Error('Installed tsup has no CLI entry point');
const result = spawnSync(process.execPath, [
  path.resolve(path.dirname(manifestPath), entry),
  ...process.argv.slice(2),
  '--out-dir', process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY || 'dist',
], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
