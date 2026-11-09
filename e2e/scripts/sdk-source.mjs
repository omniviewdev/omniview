import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveSDKSource(root, env = process.env, execute = execFileSync) {
  let output;
  try {
    output = execute('go', ['mod', 'download', '-json', 'github.com/omniviewdev/plugin-sdk'], {
      cwd: root,
      env: { ...env, GOWORK: 'off', GOFLAGS: '', GOPROXY: 'direct' },
      encoding: 'utf8',
      timeout: 120_000,
    });
  } catch (cause) {
    throw new Error('Failed to resolve SDK source from host go.mod', { cause });
  }
  let metadata;
  try {
    metadata = JSON.parse(output);
  } catch (cause) {
    throw new Error('Invalid SDK module download metadata', { cause });
  }
  // Go omits Origin from the unversioned download output even when its
  // cached .info file contains the resolved VCS identity.
  if (!metadata?.Origin && metadata?.Info) {
    try {
      metadata.Origin = JSON.parse(readFileSync(metadata.Info, 'utf8')).Origin;
    } catch (cause) {
      throw new Error('Invalid SDK module download metadata', { cause });
    }
  }
  const hash = metadata?.Origin?.Hash;
  if (typeof hash !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) {
    throw new Error('SDK module download metadata has no full Origin.Hash');
  }
  return hash;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode !== 'github-output' && mode !== 'print') throw new Error('Expected github-output or print');
  if (mode === 'github-output' && !process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const hash = resolveSDKSource(root);
  if (mode === 'github-output') appendFileSync(process.env.GITHUB_OUTPUT, `sdk=${hash}\n`);
  else process.stdout.write(`${hash}\n`);
}
