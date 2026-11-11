import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setFrontendSpanRecorder } from '@omniviewdev/runtime';
import { recordErrorBoundary } from './boundaryTelemetry';
import { queryFailureCategory, recordQueryFailure } from './queryFailure';
import { routeCategory } from '../workspace/navigationTelemetry';

type Captured = { name: string; attrs: Record<string, string | number | boolean>; failed: boolean };

describe('app shell telemetry', () => {
  let spans: Captured[];

  beforeEach(() => {
    spans = [];
    setFrontendSpanRecorder((name, attrs, _start, _end, failed) => {
      spans.push({ name, attrs: { ...attrs }, failed });
    });
  });

  afterEach(() => {
    setFrontendSpanRecorder(null);
  });

  it('maps query keys to closed categories without exporting the key', () => {
    expect(queryFailureCategory(['metric', 'query', 'secret-connection'])).toBe('metric');
    expect(queryFailureCategory(['my-plugin', 'connection', 'profiles'])).toBe('connection');
    expect(queryFailureCategory(['my-plugin', 'resource-v2', 'editor-schemas'])).toBe('resource');
    expect(queryFailureCategory(['constructor'])).toBe('other');
    expect(queryFailureCategory(undefined)).toBe('other');
  });

  it('records query failures with class and count, never the message', () => {
    recordQueryFailure('query', Object.assign(new Error('token=abc123'), { code: 'FORBIDDEN' }), ['settings', 'abc123'], 3);
    recordQueryFailure('mutation', new DOMException('aborted', 'AbortError'), undefined, 1);

    expect(spans[0]).toMatchObject({ name: 'frontend.query.failure', failed: true });
    expect(spans[0].attrs).toMatchObject({ kind: 'query', category: 'settings', failure_count: 3, canceled: false, outcome: 'failure' });
    expect(JSON.stringify(spans)).not.toContain('abc123');
  });

  it('records boundary kind and plugin id only', () => {
    recordErrorBoundary('plugin_surface', 'my-plugin');
    recordErrorBoundary('unhandled_rejection');

    expect(spans[0].attrs).toEqual({ boundary: 'plugin_surface', plugin_id: 'my-plugin' });
    expect(spans[1].attrs).toEqual({ boundary: 'unhandled_rejection' });
  });

  it('categorises routes from the first path segment only', () => {
    expect(routeCategory('/')).toBe('home');
    expect(routeCategory('/plugins?x=1')).toBe('plugin');
    expect(routeCategory('/settings/general')).toBe('settings');
    expect(routeCategory('/developer-tools/extensions')).toBe('extensions');
    expect(routeCategory('/developer-tools/performance')).toBe('other');
    expect(routeCategory('/resources/pods')).toBe('resource');
  });
});
