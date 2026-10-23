import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { OwnedProfiles } from './workspace';

for (const field of ['atomicDist', 'peers', 'runtime']) {
  for (const value of ['false', 1, {}]) {
    test(`rejects ${field} attestation ${JSON.stringify(value)} before creating a collection`, async () => {
      const arena = await realpath(await mkdtemp(join(tmpdir(), 'omniview-evidence-validation-')));
      const original = { sources: process.env.OMNIVIEW_E2E_SOURCES, cli: process.env.OMNIVIEW_E2E_CLI, temporary: process.env.TMPDIR };
      try {
        const evidence = join(arena, 'evidence.json');
        const sources = join(arena, 'sources.json');
        await writeFile(evidence, JSON.stringify({ protocol: 'workspace', versions: ['12.14.0'], atomicDist: true, peers: true, runtime: true, [field]: value }));
        await writeFile(sources, JSON.stringify({
          sources: { omniview: arena, 'plugin-sdk': arena },
          refs: { omniview: 'feature', 'plugin-sdk': 'feature' },
          repositories: [], reviewedSDKRevision: 'a'.repeat(40), linkEvidence: evidence,
        }));
        process.env.OMNIVIEW_E2E_SOURCES = sources;
        process.env.TMPDIR = arena;
        delete process.env.OMNIVIEW_E2E_CLI;
        await expect(OwnedProfiles.create()).rejects.toBeInstanceOf(Error);
        expect((await readdir(arena)).sort()).toEqual(['evidence.json', 'sources.json']);
      } finally {
        for (const [name, value] of Object.entries({ OMNIVIEW_E2E_SOURCES: original.sources, OMNIVIEW_E2E_CLI: original.cli, TMPDIR: original.temporary })) {
          if (value === undefined) {
            Reflect.deleteProperty(process.env, name);
          } else {
            process.env[name] = value;
          }
        }

        await rm(arena, { recursive: true, force: true });
      }
    });
  }
}
