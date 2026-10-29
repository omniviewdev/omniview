/** Generate dev ESM facades over the host's shared singleton registry. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_PACKAGES } from '../src/sharedPackages';
import { safeFilename } from '../src/safeFilename';
import { discoverExports, generateShim } from './shared-exports';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shimsDir = process.env.OMNIVIEW_SHIMS_OUTPUT_DIRECTORY || path.resolve(scriptDir, '..', 'shims');

async function main(): Promise<void> {
  // Resolve every package before replacing any existing facade. Missing builds
  // must fail generation rather than silently publish default-only shims.
  const shims = await Promise.all(SHARED_PACKAGES.map(async packageName => ({
    filename: `${safeFilename(packageName)}.mjs`,
    source: generateShim(packageName, (await discoverExports(packageName)).names),
  })));
  fs.mkdirSync(shimsDir, { recursive: true });
  for (const filename of fs.readdirSync(shimsDir).filter(name => name.endsWith('.mjs'))) {
    fs.unlinkSync(path.join(shimsDir, filename));
  }
  for (const shim of shims) fs.writeFileSync(path.join(shimsDir, shim.filename), shim.source);
  console.log(`Generated ${shims.length} shim files in ${shimsDir}`);
}

await main();
