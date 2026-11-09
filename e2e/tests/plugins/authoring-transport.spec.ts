import { test, expect } from '../fixtures/app.fixture';
import { goTo } from '../fixtures/helpers';
import { callBinding, Service, methodId } from '../fixtures/wails';
import type { CompletionInput, CompletionSession } from '../../../packages/omniviewdev-runtime/src/resource/v2/authoringSession';
import type { CompletionResponse, CompletionRequest } from '../../../packages/omniviewdev-runtime/src/resource/v2/authoring';


declare global {
  interface Window {
    __probeCompletionSession?: (options: { pluginID: string; documentID: string }) => CompletionSession;
  }
}
test('Completion transport: real schema edits, supersession and identity fences', async ({ appPage: page, request }, testInfo) => {
  test.slow();
  const plugin = 'workspace-probe';
  const connection = 'hypervisor-bundled-vms';
  await goTo(page, `/resources/${plugin}/${connection}`);
  const connect = page.getByRole('button', { name: 'Connect and continue' });
  const navigation = page.getByRole('navigation', { name: 'Resource types' }).filter({ hasText: connection });
  await expect(connect.or(navigation)).toBeVisible({ timeout: 15000 });
  if (await connect.isVisible()) await connect.click();
  await expect(navigation).toBeVisible({ timeout: 15000 });
  try {
    const result = await page.evaluate(async () => {
      const factory = window.__probeCompletionSession;
      if (!factory) throw new Error('probe plugin has not loaded the published runtime session');
      const session = factory({ pluginID: 'workspace-probe', documentID: 'transport-unicode' });
      const target = { route: { connection: 'hypervisor-bundled-vms' }, type: 'vm', representation: 'authoring', scope: [] };
      const run = async (source: string, cursor = source.length, maxSuggestions = 16) => {
        const outcome = await session.complete({ source, cursor, target, maxSuggestions });
        if (outcome.status !== 'applied') throw new Error(JSON.stringify(outcome));
        return outcome.response;
      };
      try {
        const source = '"😀" == "😀" && resource.hard';
        const fields = await run(source);
        const field = fields.items?.find(item => item.label === 'hardware');
        if (!field) throw new Error(JSON.stringify(fields));
        const bytes = new TextEncoder().encode(source);
        const edited = new TextDecoder().decode(bytes.slice(0, field.edit.start)) + field.edit.text + new TextDecoder().decode(bytes.slice(field.edit.end));
        const operators = await run('resource.state ');
        const values = await run('resource.state == ');
        const bounded = await run('resource.', undefined, 1);
        const inputs: CompletionInput[] = ['resource.n', 'resource.h', 'resource.hardware.c'].map(source => ({ source, cursor: source.length, target, maxSuggestions: 16 }));
        const rapid = await Promise.all(inputs.map(input => session.complete(input)));
        session.invalidate();
        const absent = await session.complete({ source: 'resource.', cursor: 9, target: { ...target, representation: 'native' }, maxSuggestions: 16 });
        const restored = await run('resource.hardware.');
        return { fields, edited, operators, values, bounded, rapid, absent, restored };
      } finally { session.dispose(); }
    });
    expect(result.fields.schema.state).toBe('available');
    expect(result.edited).toBe('"😀" == "😀" && resource.hardware');
    expect(result.operators.items?.map(item => item.label)).toContain('==');
    expect(result.values.items?.map(item => item.edit.text)).toContain('"running"');
    expect(result.bounded.items?.length).toBeLessThanOrEqual(1);
    expect(result.bounded.completion.kind).toBe('truncated');
    expect(result.rapid.slice(0, -1).every(outcome => outcome.status !== 'applied')).toBe(true);
    expect(result.rapid.at(-1)?.status).toBe('applied');
    expect(result.absent.status).toBe('applied');
    if (result.absent.status === 'applied') expect(result.absent.response.schema.state).toBe('absent');
    expect(result.restored.items?.map(item => item.label)).toContain('cores');

    const id = methodId(Service.resource, 'CompletePredicate');
    const fenced = await page.evaluate(async ({ id, baseline }) => {
      const payload: CompletionRequest = {
        version: 'omniview.authoring.v1', profile: 'omniview.resource-predicate.v1',
        documentId: 'transport-fence', requestId: 'fence-1', documentRevision: 1,
        source: 'resource.', cursor: { offset: 9, unit: 'utf8-byte' },
        target: { route: { connection: 'hypervisor-bundled-vms' }, type: 'vm', representation: 'authoring', scope: [] },
        schemaRevision: baseline.identity.schemaRevision + '-stale', maxSuggestions: 8,
      };
      const response = await fetch('/wails/runtime', { method: 'POST', headers: { 'content-type': 'application/json', 'x-wails-client-id': 'e2e-authoring' }, body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': 'authoring-fence', methodID: id, args: ['workspace-probe', payload] } }) });
      return { status: response.status, body: await response.text() };
    }, { id, baseline: result.fields as CompletionResponse });
    expect(fenced.status).toBeGreaterThanOrEqual(400);
    expect(fenced.body).toContain('RESET_REQUIRED');
    await testInfo.attach('completion-transport.json', { body: JSON.stringify({ result, fenced }, null, 2), contentType: 'application/json' });
  } finally {
    await callBinding(request, Service.resource, 'StopConnection', plugin, connection);
  }
});
