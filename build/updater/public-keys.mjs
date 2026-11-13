import { fileURLToPath } from 'node:url';

export function publicKeysCSV(value) {
  let keys;
  try { keys = JSON.parse(value); } catch { throw new Error('UPDATER_PUBLIC_KEYS must be a non-empty JSON array of lowercase 64-hex keys'); }
  if (!Array.isArray(keys) || keys.length === 0 || !keys.every((key) => typeof key === 'string' && /^[0-9a-f]{64}$/.test(key))) {
    throw new Error('UPDATER_PUBLIC_KEYS must be a non-empty JSON array of lowercase 64-hex keys');
  }
  return keys.join(',');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(publicKeysCSV(process.env.UPDATER_PUBLIC_KEYS)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
