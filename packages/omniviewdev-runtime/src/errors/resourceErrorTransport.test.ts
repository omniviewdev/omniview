import { readFile } from 'node:fs/promises';
import { parseAppError } from './parseAppError';

const corpusPath = process.env.C02_ERROR_CORPUS;
if (process.env.CI && !corpusPath) {
  throw new Error('C02_ERROR_CORPUS is required in CI; generate the actual Go transport corpus before running this test.');
}

it.skipIf(!corpusPath)('decodes the actual SDK→gRPC→host error corpus without changing meaning', async () => {
  const corpus = JSON.parse(await readFile(corpusPath!, 'utf8')) as Array<{ wire: string; code: string; type: string; status: number }>;
  expect(new Set(corpus.map(item => item.code))).toEqual(new Set([
    'FORBIDDEN', 'UNAUTHORIZED', 'INVALID_REQUEST', 'UNSUPPORTED', 'PARTIAL_RESULT',
    'RESOURCE_LIMIT', 'RESET_REQUIRED', 'PROVIDER_ERROR', 'CANCELLED',
  ]));
  for (const item of corpus) {
    const error = parseAppError(new Error(item.wire));
    expect(error.code).toBe(item.code);
    expect(error.type).toBe(item.type);
    expect(error.status).toBe(item.status);
    expect(error.requestId).toBeTruthy();
    if (['FORBIDDEN', 'UNAUTHORIZED', 'PROVIDER_ERROR'].includes(item.code)) expect(JSON.stringify(error)).not.toContain('secret');
  }
});
