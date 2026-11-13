import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManifest, keyIdForPublicKey, signEnvelope } from './envelope.mjs';
import { publicKeysCSV } from './public-keys.mjs';
import { api, upload } from './publish-to-update-service.mjs';

const seed = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const publicKey = createPublicKey(createPrivateKey({ key: Buffer.from(`302e020100300506032b657004220420${seed}`, 'hex'), format: 'der', type: 'pkcs8' }));
const run = promisify(execFile);
const cli = fileURLToPath(new URL('./publish-to-update-service.mjs', import.meta.url));

test('cross-language signing vector', () => {
  const payload = Buffer.from('{"schema":"omniview-update-manifest/v1","product":"omniview","channel":"nightly","version":"0.0.0-nightly.20261112.1.1","artifacts":[]}');
  const envelope = JSON.parse(signEnvelope(payload, [seed]));
  assert.equal(keyIdForPublicKey(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)), '56475aa75463474c');
  assert.deepEqual(envelope.signatures, [{ keyId: '56475aa75463474c', algorithm: 'ed25519', signature: 'tbxUPKBag/bumf/HzNRVzUgoOgUTL2AtTfylGBAV8vowq+qWFgHYC5vwH2iLTRQejzliGakO4yk7HwM2OOnsCg==' }]);
  assert.deepEqual(Buffer.from(envelope.payload, 'base64'), payload);
});

test('manifest envelope round trip and key validation', () => {
  const payload = buildManifest({ channel: 'stable', version: '1.4.0', gitSha: 'a'.repeat(40), issuedAt: '2026-11-12T00:00:00Z', releaseUrl: 'https://example.com', artifacts: [] });
  const envelope = JSON.parse(signEnvelope(payload, [seed]));
  assert.equal(envelope.schema, 'omniview-update-envelope/v1');
  assert.deepEqual(Buffer.from(envelope.payload, 'base64'), payload);
  assert.equal(JSON.parse(payload).notes, '');
  assert.ok(verify(null, payload, publicKey, Buffer.from(envelope.signatures[0].signature, 'base64')));
  assert.throws(() => signEnvelope(payload, []));
  assert.throws(() => signEnvelope(payload, [seed, seed]));
  assert.throws(() => signEnvelope(payload, ['invalid']));
});

async function fixture(t, handler, version = '1.4.0') {
  const dir = await mkdtemp(join(tmpdir(), 'updater-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const suffix of ['darwin_universal.zip', 'darwin_universal.dmg', 'linux_amd64', 'windows_amd64.exe']) {
    await writeFile(join(dir, `Omniview_${version}_${suffix}`), `artifact ${suffix}`);
  }
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const args = [cli, '--channel', 'stable', '--version', version, '--dir', dir, '--git-sha', 'a'.repeat(40), '--run-url', 'https://github.com/run/1'];
  const env = { ...process.env, UPDATER_SIGNING_KEYS: JSON.stringify([seed]), UPDATE_SERVICE_URL: base, UPDATE_SERVICE_PUBLISH_TOKEN: 'test-token' };
  return { base, args, env };
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('create conflict reports status and exits nonzero', async (t) => {
  const { args, env } = await fixture(t, async (req, res) => {
    await body(req);
    res.writeHead(409, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'release exists', status: 'active' }));
  });
  await assert.rejects(run(process.execPath, args, { env }), (error) => {
    assert.match(error.stderr, /409.*active.*release exists/);
    return true;
  });
});

test('stable build metadata reaches the service unchanged', async (t) => {
  const { args, env } = await fixture(t, async (req, res) => {
    const release = JSON.parse(await body(req));
    assert.equal(release.version, '1.4.0+ci.1');
    res.writeHead(409).end(JSON.stringify({ error: 'release exists', status: 'active' }));
  }, '1.4.0+ci.1');
  await assert.rejects(run(process.execPath, args, { env }), (error) => {
    assert.match(error.stderr, /409.*active/);
    return true;
  });
});

test('public key configuration requires a non-empty array of lowercase keys', () => {
  const key = 'ab'.repeat(32);
  assert.equal(publicKeysCSV(JSON.stringify([key, '01'.repeat(32)])), `${key},${'01'.repeat(32)}`);
  for (const value of ['', '[]', '{}', 'null', '[""]', '["AB"]', JSON.stringify([key.toUpperCase()]), JSON.stringify([key, 42])]) {
    assert.throws(() => publicKeysCSV(value), /UPDATER_PUBLIC_KEYS/);
  }
});

test('API deadline aborts a stalled response body', async (t) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  await assert.rejects(api(`http://127.0.0.1:${server.address().port}`, 'token', 'POST', {}, AbortSignal.timeout(100)));
});

test('upload deadline retries stalled requests', async (t) => {
  let attempts = 0;
  const server = createServer(async (req, res) => {
    await body(req);
    if (++attempts === 2) res.writeHead(200).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  await upload({ method: 'PUT', url: `http://127.0.0.1:${server.address().port}`, headers: {} }, 1, () => Buffer.from('x'), 100, [0]);
  assert.equal(attempts, 2);
});

test('publishes streamed artifacts and signed envelope before finalize', async (t) => {
  const uploads = new Map();
  let created;
  let finalized = false;
  let base;
  let retried = false;
  const fixtureData = await fixture(t, async (req, res) => {
    const data = await body(req);
    if (req.method === 'POST' && req.url === '/v1/publish/releases') {
      assert.equal(req.headers.authorization, 'Bearer test-token');
      created = JSON.parse(data);
      const descriptor = (filename, type) => ({ filename, method: 'PUT', url: `${base}/upload/${encodeURIComponent(filename)}`, headers: { 'Content-Type': type } });
      res.writeHead(201).end(JSON.stringify({ id: 'release-1', uploads: created.artifacts.map((a) => descriptor(a.filename, 'application/octet-stream')), manifestUpload: descriptor('manifest.json', 'application/json') }));
    } else if (req.method === 'PUT') {
      assert.equal(Number(req.headers['content-length']), data.length);
      if (!retried) {
        retried = true;
        res.writeHead(503).end();
        return;
      }
      uploads.set(decodeURIComponent(req.url.slice('/upload/'.length)), data);
      res.writeHead(200).end();
    } else if (req.method === 'POST' && req.url.endsWith('/finalize')) {
      assert.equal(uploads.size, 5);
      finalized = true;
      res.writeHead(202).end('{}');
    } else {
      assert.ok(finalized);
      res.writeHead(200).end(JSON.stringify({ status: 'active' }));
    }
  });
  base = fixtureData.base;
  const result = await run(process.execPath, fixtureData.args, { env: fixtureData.env });
  assert.match(result.stdout, /active/);
  const envelope = JSON.parse(uploads.get('manifest.json'));
  const payload = Buffer.from(envelope.payload, 'base64');
  assert.ok(verify(null, payload, publicKey, Buffer.from(envelope.signatures[0].signature, 'base64')));
  const manifest = JSON.parse(payload);
  assert.equal(manifest.artifacts.length, 4);
  assert.equal(manifest.releaseUrl, 'https://github.com/omniviewdev/omniview/releases/tag/v1.4.0');
  for (const artifact of manifest.artifacts) {
    assert.equal(uploads.get(artifact.filename).length, artifact.size);
    assert.ok(artifact.url.endsWith(`/stable/1.4.0/${artifact.filename}`));
  }
  assert.ok(retried);
});
