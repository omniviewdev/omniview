import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { buildManifest, signEnvelope } from './envelope.mjs';

const CDN = 'https://updates.omniview.dev';
const MAX_SIZE = 1024 * 1024 * 1024;
const API_TIMEOUT_MS = 30 * 1000;
const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--channel', '--version', '--dir', '--git-sha', '--run-url'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || result[key]) {
      throw new Error(`invalid argument: ${key}`);
    }
    result[key] = args[i + 1];
  }
  for (const key of ['--channel', '--version', '--dir', '--git-sha', '--run-url']) {
    if (!result[key]) throw new Error(`missing ${key}`);
  }
  const { '--channel': channel, '--version': version, '--git-sha': gitSha } = result;
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  const feature = /^feature-[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(channel)
    && new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)-${channel}\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$`).test(version);
  if (!(channel === 'stable' && stable.test(version)) && !(channel === 'nightly' && /^0\.0\.0-nightly\.\d{8}\.\d+\.\d+$/.test(version)) && !feature) throw new Error('invalid channel or version');
  if (!/^[0-9a-f]{40}$/.test(gitSha)) throw new Error('git SHA must be 40 lowercase hex characters');
  return result;
}

async function describeFile(dir, channel, version, platform, arch, kind, suffix) {
  const filename = `Omniview_${version}_${suffix}`;
  const path = join(dir, filename);
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > MAX_SIZE) throw new Error(`invalid artifact size: ${filename}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { platform, arch, kind, filename, url: `${CDN}/releases/${channel}/${version}/${filename}`, size: info.size, sha256: hash.digest('hex') };
}

export async function api(url, token, method, body, signal = AbortSignal.timeout(API_TIMEOUT_MS)) {
  const response = await fetch(url, {
    method, signal,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`update service returned HTTP ${response.status} with invalid JSON`); }
  if (!response.ok) throw new Error(`update service returned HTTP ${response.status}${data.status ? `: ${data.status}` : ''}${data.error ? `: ${data.error}` : ''}`);
  return data;
}

export async function upload(target, size, bodyFactory, timeoutMs = UPLOAD_TIMEOUT_MS, delays = [5000, 15000, 45000]) {
  if (target.method !== 'PUT' || !target.url || !target.headers) throw new Error('invalid upload descriptor');
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(target.url, { method: 'PUT', headers: { ...target.headers, 'Content-Length': String(size) }, body: bodyFactory(), duplex: 'half', signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (attempt === delays.length) throw new Error('upload failed after retries', { cause: error });
      await sleep(delays[attempt]);
      continue;
    }
    if (response.ok) { await response.body?.cancel(); return; }
    await response.body?.cancel();
    if (response.status < 500 || attempt === delays.length) throw new Error(`upload failed with HTTP ${response.status}`);
    await sleep(delays[attempt]);
  }
}

async function main() {
  const args = options(process.argv.slice(2));
  const channel = args['--channel'];
  const version = args['--version'];
  const dir = args['--dir'];
  const gitSha = args['--git-sha'];
  const token = process.env.UPDATE_SERVICE_PUBLISH_TOKEN;
  const service = process.env.UPDATE_SERVICE_URL?.replace(/\/$/, '');
  if (!token || !service || !process.env.UPDATER_SIGNING_KEYS) throw new Error('UPDATE_SERVICE_URL, UPDATE_SERVICE_PUBLISH_TOKEN and UPDATER_SIGNING_KEYS are required');
  const keys = JSON.parse(process.env.UPDATER_SIGNING_KEYS);
  const artifacts = await Promise.all([
    describeFile(dir, channel, version, 'darwin', 'universal', 'update', 'darwin_universal.zip'),
    describeFile(dir, channel, version, 'darwin', 'universal', 'installer', 'darwin_universal.dmg'),
    describeFile(dir, channel, version, 'linux', 'amd64', 'update', 'linux_amd64'),
    describeFile(dir, channel, version, 'windows', 'amd64', 'update', 'windows_amd64.exe'),
  ]);
  const manifest = buildManifest({ channel, version, gitSha, issuedAt: new Date().toISOString(), releaseUrl: channel === 'stable' ? `https://github.com/omniviewdev/omniview/releases/tag/v${version}` : '', artifacts });
  const envelope = signEnvelope(manifest, keys);
  if (envelope.length > 1024 * 1024) throw new Error('envelope exceeds 1 MiB');
  const release = await api(`${service}/v1/publish/releases`, token, 'POST', { channel, version, gitSha, ciRunUrl: args['--run-url'], artifacts: artifacts.map(({ url, ...artifact }) => artifact) });
  if (typeof release.id !== 'string' || !Array.isArray(release.uploads)) throw new Error('invalid create response');
  const releaseURL = `${service}/v1/publish/releases/${encodeURIComponent(release.id)}`;
  for (const artifact of artifacts) {
    const matches = release.uploads.filter((item) => item.filename === artifact.filename);
    if (matches.length !== 1) throw new Error(`missing or duplicate upload descriptor: ${artifact.filename}`);
    const { chunkSize, chunks } = matches[0];
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 5 * 1024 * 1024 || chunkSize > 16 * 1024 * 1024 || !Array.isArray(chunks) || chunks.length !== Math.ceil(artifact.size / chunkSize)) throw new Error('invalid chunk upload descriptors');
    for (let i = 0; i < chunks.length; i++) {
      const start = i * chunkSize;
      const size = Math.min(chunkSize, artifact.size - start);
      await upload(chunks[i], size, () => createReadStream(join(dir, artifact.filename), { start, end: start + size - 1 }));
    }
    await api(`${releaseURL}/assemble`, token, 'POST', { filename: artifact.filename }, AbortSignal.timeout(UPLOAD_TIMEOUT_MS));
  }
  await upload(release.manifestUpload, envelope.length, () => envelope);
  await api(`${releaseURL}/finalize`, token, 'POST');
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    let status;
    try {
      status = await api(releaseURL, token, 'GET', undefined, AbortSignal.timeout(Math.max(1, deadline - Date.now())));
    } catch (error) {
      if (Date.now() >= deadline) throw new Error('release validation timed out after 30 minutes');
      throw error;
    }
    if (status.status === 'ready' || status.status === 'active') { console.log(`Published ${channel} ${version}: ${status.status}`); return; }
    if (status.status === 'rejected') throw new Error(`release rejected: ${status.validationError || 'no validation error provided'}`);
    await sleep(Math.min(10000, Math.max(0, deadline - Date.now())));
  }
  throw new Error('release validation timed out after 30 minutes');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
