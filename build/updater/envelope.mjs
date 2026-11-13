import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function keyIdForPublicKey(raw32) {
  if (!Buffer.isBuffer(raw32) || raw32.length !== 32) throw new Error('public key must be 32 bytes');
  return createHash('sha256').update(raw32).digest('hex').slice(0, 16);
}

export function signEnvelope(manifestBytes, seedsHex) {
  if (!Buffer.isBuffer(manifestBytes)) throw new Error('manifest must be a Buffer');
  if (!Array.isArray(seedsHex) || seedsHex.length === 0) throw new Error('signing keys must be a non-empty array');
  const seen = new Set();
  const signatures = seedsHex.map((seed) => {
    if (typeof seed !== 'string' || !/^[0-9a-f]{64}$/.test(seed)) throw new Error('signing seed must be 64 lowercase hex characters');
    const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed, 'hex')]), format: 'der', type: 'pkcs8' });
    const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
    const keyId = keyIdForPublicKey(publicKey);
    if (seen.has(keyId)) throw new Error(`duplicate signing key ID: ${keyId}`);
    seen.add(keyId);
    return { keyId, algorithm: 'ed25519', signature: sign(null, manifestBytes, key).toString('base64') };
  });
  return Buffer.from(JSON.stringify({ schema: 'omniview-update-envelope/v1', payload: manifestBytes.toString('base64'), signatures }));
}

export function buildManifest({ channel, version, gitSha, issuedAt, releaseUrl, artifacts }) {
  return Buffer.from(JSON.stringify({ schema: 'omniview-update-manifest/v1', product: 'omniview', channel, version, gitSha, issuedAt, notes: '', releaseUrl, artifacts }));
}
