import { test, expect } from '../fixtures/app.fixture';
import { goTo } from '../fixtures/helpers';
import { callBinding, Service, methodId } from '../fixtures/wails';
import type { CompletionInput, CompletionSession } from '../../../packages/omniviewdev-runtime/src/resource/v2/authoringSession';
import type { CompletionResponse, CompletionRequest } from '../../../packages/omniviewdev-runtime/src/resource/v2/authoring';


declare global {
  // Window augmentation requires an interface for declaration merging.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    __probeCompletionSession?: (options: { pluginID: string; documentID: string }) => CompletionSession;
  }
}
test('Completion transport: real schema edits, supersession and identity fences', async ({ appPage: page, request }, testInfo) => {
  test.slow();
  const plugin = 'workspace-probe';
  const connection = 'hypervisor-bundled-vms';
  for (const name of [connection, 'cloud-bundled-pages']) {
    await goTo(page, `/resources/${plugin}/${name}`);
    const connect = page.getByRole('button', { name: 'Connect and continue' });
    const navigation = page.getByRole('navigation', { name: 'Resource types' }).filter({ hasText: name });
    await expect(connect.or(navigation)).toBeVisible({ timeout: 15000 });
    if (await connect.isVisible()) {
      await connect.click();
    }

    await expect(navigation).toBeVisible({ timeout: 15000 });
  }

  try {
    const result = await page.evaluate(async () => {
      const factory = window.__probeCompletionSession;
      if (!factory) {
        throw new Error('probe plugin has not loaded the published runtime session');
      }

      const session = factory({ pluginID: 'workspace-probe', documentID: 'transport-unicode' });
      const target = { route: { connection: 'hypervisor-bundled-vms' }, type: 'vm', representation: 'authoring', scope: [] };
      const run = async (source: string, cursor = source.length, maxSuggestions = 16) => {
        const outcome = await session.complete({ source, cursor, target, maxSuggestions });
        if (outcome.status !== 'applied') {
          throw new Error(JSON.stringify(outcome));
        }

        return outcome.response;
      };

      try {
        const source = '"😀" == "😀" && resource.hard == null';
        const fields = await run(source, source.indexOf(' == null'));
        const field = fields.items?.find(item => item.label === 'hardware');
        if (!field) {
          throw new Error(JSON.stringify(fields));
        }

        const bytes = new TextEncoder().encode(source);
        const edited = new TextDecoder().decode(bytes.slice(0, field.edit.start)) + field.edit.text + new TextDecoder().decode(bytes.slice(field.edit.end));
        const operators = await run('resource.state ');
        const values = await run('resource.state == ');
        const bounded = await run('resource.', undefined, 1);
        const inputs: CompletionInput[] = ['resource.n', 'resource.h', 'resource.hardware.c'].map(source => ({ source, cursor: source.length, target, maxSuggestions: 16 }));
        const rapid = await Promise.all(inputs.map(async input => session.complete(input)));
        session.invalidate();
        const absent = await session.complete({ source: 'resource.', cursor: 9, target: { ...target, representation: 'native' }, maxSuggestions: 16 });
        const restored = await run('resource.hardware.');
        const cloud = await session.complete({
          source: 'resource.hardware.', cursor: 18,
          target: { ...target, route: { connection: 'cloud-bundled-pages' }, type: 'compute/instance',
            scope: [{ dimension: 'region', match: 'oneOf', values: ['us-west-2'] }] },
          maxSuggestions: 16,
        });
        return { fields, edited, operators, values, bounded, rapid, absent, restored, cloud };
      } finally {
        session.dispose(); 
      }
    });
    expect(result.fields.schema.state).toBe('available');
    expect(result.edited).toBe('"😀" == "😀" && resource.hardware == null');
    expect(result.operators.items?.map(item => item.label)).toContain('==');
    expect(result.values.items?.map(item => item.edit.text)).toContain('"running"');
    expect(result.bounded.items?.length).toBeLessThanOrEqual(1);
    expect(result.bounded.completion.kind).toBe('truncated');
    expect(result.rapid.slice(0, -1).every(outcome => outcome.status !== 'applied')).toBe(true);
    expect(result.rapid.at(-1)?.status).toBe('applied');
    expect(result.absent.status).toBe('applied');
    if (result.absent.status === 'applied') {
      expect(result.absent.response.schema.state).toBe('absent');
    }

    expect(result.restored.items?.map(item => item.label)).toContain('cores');
    expect(result.cloud.status).toBe('applied');
    if (result.cloud.status === 'applied') {
      expect(result.cloud.response.identity).toMatchObject({ connection: 'cloud-bundled-pages', type: 'compute/instance' });
      expect(result.cloud.response.identity.scopeKey).not.toBe(result.fields.identity.scopeKey);
      expect(result.cloud.response.identity.schemaRevision).not.toBe(result.fields.identity.schemaRevision);
      expect(result.cloud.response.items?.map(item => item.label)).toContain('cores');
    }

    const id = methodId(Service.resource, 'CompletePredicate');
    const fenced = await page.evaluate(async ({ id, baseline }) => {
      const payload: CompletionRequest = {
        version: 'omniview.authoring.v1', profile: 'omniview.resource-predicate.v1',
        documentId: 'transport-fence', requestId: 'fence-1', documentRevision: 1,
        source: 'resource.', cursor: { offset: 9, unit: 'utf8-byte' },
        target: { route: { connection: 'hypervisor-bundled-vms' }, type: 'vm', representation: 'authoring', scope: [] },
        maxSuggestions: 8,
      };
      const facts = [];
      const members = ['schemaRevision', 'catalogRevision', 'representationRevision', 'environmentRevision', 'accessGeneration'] as const;
      const expected = Object.fromEntries(members.map(member => [member, baseline.identity[member]]));
      const accepted = await fetch('/wails/runtime', { method: 'POST', headers: { 'content-type': 'application/json', 'x-wails-client-id': 'e2e-authoring' }, body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': 'authoring-baseline', methodID: id, args: ['workspace-probe', { ...payload, ...expected }] } }) });
      const baselineResult = { status: accepted.status, body: await accepted.text() };
      for (const [index, member] of members.entries()) {
        const draft = { ...payload, ...expected, documentRevision: index + 2, requestId: `fence-${index}`, [member]: baseline.identity[member] + '-stale' };
        const response = await fetch('/wails/runtime', { method: 'POST', headers: { 'content-type': 'application/json', 'x-wails-client-id': 'e2e-authoring' }, body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `authoring-fence-${index}`, methodID: id, args: ['workspace-probe', draft] } }) });
        facts.push({ member, status: response.status, body: await response.text() });
      }

      return { baselineResult, facts };
    }, { id, baseline: result.fields });
    expect(fenced.baselineResult.status, fenced.baselineResult.body).toBe(200);
    for (const fence of fenced.facts) {
      expect(fence.status, fence.member).toBeGreaterThanOrEqual(400);
      expect(fence.body, fence.member).toContain('RESET_REQUIRED');
      expect(fence.body, fence.member).toContain(fence.member);
    }

    await testInfo.attach('completion-transport.json', { body: JSON.stringify({ result, fenced }, null, 2), contentType: 'application/json' });
  } finally {
    await callBinding(request, Service.resource, 'StopConnection', plugin, connection);
    await callBinding(request, Service.resource, 'StopConnection', plugin, 'cloud-bundled-pages');
  }
});
