import { readFile } from 'node:fs/promises';
import { parseAppError } from './parseAppError';

const corpusPath = process.env.C02_ERROR_CORPUS;

it.skipIf(!corpusPath)('decodes the actual SDK→gRPC→host error corpus without changing meaning', async () => {
  const corpus = JSON.parse(await readFile(corpusPath!, 'utf8')) as Array<{ wire: string; code: string; type: string; status: number }>;
  expect(corpus.length).toBeGreaterThan(0);
  for (const item of corpus) {
    const error = parseAppError(new Error(item.wire));
    expect(error.code).toBe(item.code);
    expect(error.type).toBe(item.type);
    expect(error.status).toBe(item.status);
    expect(error.requestId).toBeTruthy();
    if (['FORBIDDEN', 'UNAUTHORIZED', 'PROVIDER_ERROR'].includes(item.code)) expect(JSON.stringify(error)).not.toContain('secret');
  }
});
