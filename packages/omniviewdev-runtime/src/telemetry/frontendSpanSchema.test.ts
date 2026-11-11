import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { frontendSpanSchema, sanitizeFrontendAttributes } from './frontendSpanSchema';

describe('frontend span schema', () => {
  it('matches the host schema', () => {
    const rootPath = resolve(process.cwd(), 'internal/telemetry/frontend_span_schema.json');
    const schemaPath = existsSync(rootPath) ? rootPath : resolve(process.cwd(), '../../internal/telemetry/frontend_span_schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    expect(frontendSpanSchema).toEqual(schema);
  });
  it('removes unknown and invalid attributes', () => {
    expect(sanitizeFrontendAttributes('frontend.resource.call', { operation: 'get', plugin_id: 'Bad/ID', secret: 'token' })).toEqual({ operation: 'get' });
  });
});
