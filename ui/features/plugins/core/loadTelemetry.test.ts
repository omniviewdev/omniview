import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginWindow, setFrontendSpanRecorder } from '@omniviewdev/runtime';
import { PluginService } from './PluginService';
import { createDeferred, createTestDeps } from '../testing/helpers';
import type { PluginServiceConfig } from './types';

type Captured = { name: string; attrs: Record<string, string | number | boolean>; failed: boolean };

function setup(config?: Partial<PluginServiceConfig>) {
  const t = createTestDeps();
  return { service: new PluginService(t.deps, config), ...t };
}

describe('plugin load telemetry', () => {
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

  const named = (name: string) => spans.filter((span) => span.name === name);

  it('records load and import spans for a successful load', async () => {
    const s = setup();
    s.importer.register('a', { plugin: new PluginWindow(), extensionRegistrations: [], sidebars: {}, drawers: {} });
    await s.service.load('a');

    expect(named('frontend.plugin.load')).toHaveLength(1);
    expect(named('frontend.plugin.load')[0].attrs).toMatchObject({ plugin_id: 'a', source: 'external', outcome: 'success', timed_out: false });
    expect(named('frontend.plugin.import')[0].attrs).toMatchObject({ plugin_id: 'a', outcome: 'success', timed_out: false, late_settle: false });
  });

  it('classifies a failed import without exporting the error message', async () => {
    const s = setup();
    s.importer.register('a', () => {
      throw new Error('token=abc123 https://example.invalid/entry.js');
    });
    await s.service.load('a');

    const load = named('frontend.plugin.load')[0];
    expect(load.attrs).toMatchObject({ phase: 'import', outcome: 'failure', error_class: 'other' });
    expect(load.failed).toBe(true);
    expect(JSON.stringify(spans)).not.toContain('abc123');
    expect(JSON.stringify(spans)).not.toContain('example.invalid');
  });

  it('records a validation failure phase', async () => {
    const s = setup();
    s.importer.register('a', { bad: true });
    await s.service.load('a');

    expect(named('frontend.plugin.load')[0].attrs).toMatchObject({ phase: 'validate', outcome: 'failure' });
  });

  it('records import timeouts and late settlement after the timeout', async () => {
    const s = setup({ importTimeoutMs: 10 });
    const deferred = createDeferred<unknown>();
    s.importer.register('a', async () => deferred.promise);
    await s.service.load('a');

    expect(named('frontend.plugin.load')[0].attrs).toMatchObject({ timed_out: true, outcome: 'failure', error_class: 'timeout' });
    expect(named('frontend.plugin.import')).toHaveLength(1);
    expect(named('frontend.plugin.import')[0].attrs).toMatchObject({ timed_out: true, late_settle: false, error_class: 'timeout' });

    deferred.resolve({ plugin: new PluginWindow() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const imports = named('frontend.plugin.import');
    expect(imports).toHaveLength(2);
    expect(imports[1].attrs).toMatchObject({ timed_out: true, late_settle: true, outcome: 'success' });
  });

  it('records the retry count on retry attempts', async () => {
    const s = setup({ retryBaseDelayMs: 0, retryMaxDelayMs: 0 });
    s.importer.register('a', { bad: true });
    await s.service.load('a');
    await s.service.retry('a');

    const loads = named('frontend.plugin.load');
    expect(loads).toHaveLength(2);
    expect(loads[1].attrs).toMatchObject({ retry: 1, outcome: 'failure' });
  });
});
