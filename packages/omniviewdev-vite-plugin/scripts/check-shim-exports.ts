import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { safeFilename } from '../src/safeFilename';
import { SHARED_PACKAGES } from '../src/sharedPackages';

const runtimePackages = SHARED_PACKAGES.filter(
  packageName => packageName === '@omniviewdev/runtime' || packageName.startsWith('@omniviewdev/runtime/'),
);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shimsDir = process.env.OMNIVIEW_SHIMS_OUTPUT_DIRECTORY || path.resolve(scriptDir, '..', 'shims');

function extractExportNames(source: string): Set<string> {
  const names = new Set<string>();

  for (const match of source.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }

  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const specifier of block[1].split(',')) {
      const parts = specifier.trim().split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0]).trim();
      if (name && name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name)) {
        names.add(name);
      }
    }
  }

  return names;
}

export function findMissingShimExports(runtimeSource: string, shimSource: string): string[] {
  const runtimeExports = extractExportNames(runtimeSource);
  const shimExports = extractExportNames(shimSource);
  return [...runtimeExports].filter(name => !shimExports.has(name)).sort();
}

function checkRuntimeShims(): void {
  for (const packageName of runtimePackages) {
    const runtimePath = fileURLToPath(import.meta.resolve(packageName));
    const shimPath = path.join(shimsDir, `${safeFilename(packageName)}.mjs`);
    const missing = findMissingShimExports(
      fs.readFileSync(runtimePath, 'utf8'),
      fs.readFileSync(shimPath, 'utf8'),
    );

    if (missing.length > 0) {
      throw new Error(
        `Dev shim for ${packageName} is missing exports: ${missing.join(', ')}. ` +
        'Build @omniviewdev/runtime, then regenerate the shims.',
      );
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkRuntimeShims();
}
