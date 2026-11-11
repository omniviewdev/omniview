import type { APIRequestContext, Page, Request } from '@playwright/test';
import { test as base, expect } from '../fixtures/app.fixture';
import { goTo } from '../fixtures/helpers';
import { callBinding, Service, methodId } from '../fixtures/wails';
import type { Catalog, SchemaRequest } from '../../../packages/omniviewdev-runtime/src/resource/v2/domain';
import type { EditorSchemaResult, SchemaFieldsResult } from '../../../packages/omniviewdev-runtime/src/resource/v2/schema';

/**
 * Real-application evidence for target-bound schemas on provider-neutral connections.
 * Browsing must not demand schemas. Native schemas remain absent and dynamically evaluated,
 * even after the same route's authoring schema is resolved. Schema fields and editor documents
 * must describe one coherent route/type/representation observation.
 *
 * Every call crosses the real host runtime and the probe plugin's gRPC boundary. Unknown types,
 * stale or foreign representation revisions, and unreferenced documents must not borrow another
 * target's schema. Model URI ownership belongs to the frontend, not the schema service.
 */

const pluginID = 'workspace-probe';
// Connection lifecycle runs through the backend, the module transport and React: allow for it.
const lifecycle = { timeout: 15_000 };
// Each fixed probe connection with the one type its catalog advertises, and the operations that type declares.
type Probe = { connection: string; type: string; operations: string[] };
const probes: Probe[] = [
  { connection: 'cloud-bundled-pages', type: 'compute/instance', operations: ['enumerate', 'get'] },
  { connection: 'container-bundled-events', type: 'container', operations: ['enumerate', 'get', 'sourceUpdates'] },
  { connection: 'hypervisor-bundled-vms', type: 'vm', operations: ['enumerate', 'get'] },
  { connection: 'kubernetes-snapshot', type: 'core::v1::Pod', operations: ['enumerate', 'get'] },
];
const unreferencedSchemaDocument = { id: 'p07-e2e/unreferenced', revision: 'schema:p07-e2e/1' };

// The probe connections are started through the browser's own Connect action. Stop them afterwards, so
// the shared profile keeps the state the test found.
const test = base.extend<{ stopProbeConnections: void }>({
  stopProbeConnections: [async ({ request }, use) => {
    await use();
    for (const { connection } of probes) {
      await callBinding(request, Service.resource, 'StopConnection', pluginID, connection);
      const status = await callBinding<{ status: string }>(request, Service.resource, 'CheckConnection', pluginID, connection);
      expect(status.status, `the ${connection} connection is stopped again`).toBe('DISCONNECTED');
    }
  }, { auto: true }],
});

/**
 * Starts a probe connection through the browser's own Connect action, then waits until the host reports
 * it connected. The Resource types navigation is matched by the connection it names: the page of the
 * previous connection is still mounted for a moment after the router moves on.
 */
async function connectThroughBrowser(page: Page, request: APIRequestContext, connection: string): Promise<void> {
  await goTo(page, `/resources/${pluginID}/${connection}`);
  const connect = page.getByRole('button', { name: 'Connect and continue' });
  const types = page.getByRole('navigation', { name: 'Resource types' }).filter({ hasText: connection });
  await expect(connect.or(types)).toBeVisible(lifecycle);
  if (await connect.isVisible()) {
    await connect.click();
  }

  await expect(types).toBeVisible(lifecycle);
  await expect.poll(async () => (await callBinding<{ status: string }>(request, Service.resource, 'CheckConnection', pluginID, connection)).status, lifecycle).toBe('CONNECTED');
}

/**
 * The host application error code of a rejected binding call. Wails reports a failed method as a
 * call error whose message is the host's AppError JSON.
 */
function appErrorCode(error: unknown, depth = 0): string | undefined {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  const start = text?.indexOf('{') ?? -1;
  if (text === undefined || start < 0 || depth > 4) {
    return undefined;
  }

  const parsed = JSON.parse(text.slice(start)) as { code?: unknown; message?: unknown };
  return typeof parsed.code === 'string' ? parsed.code : appErrorCode(parsed.message, depth + 1);
}

/** Awaits a binding call that must be rejected: the application error code it carries, and the raw message. */
async function rejection(call: Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  let failure: unknown;
  try {
    await call;
  } catch (error) {
    failure = error;
  }

  expect(failure, 'the call is rejected').toBeInstanceOf(Error);
  return { code: appErrorCode(failure), message: failure instanceof Error ? failure.message : String(failure) };
}

test.describe('Schema catalog', () => {
  test('schemas are demanded per target and remain isolated across representations and routes', async ({ appPage: page, request }, testInfo) => {
    test.slow();
    const facts: Array<Record<string, unknown>> = [];
    const authoringRequests = new Map<string, SchemaRequest>();
    const schemaMethods = ['ResolveSchema', 'ResolveEditorSchema', 'GetSchemaFields', 'GetSchemaDocument'];
    const schemaMethodIDs = new Map(schemaMethods.map(method => [methodId(Service.resource, method), method]));
    const browserSchemaCalls: string[] = [];
    const observeBrowserSchemaCall = (browserRequest: Request) => {
      if (!new URL(browserRequest.url()).pathname.endsWith('/wails/runtime') || browserRequest.method() !== 'POST') {
        return;
      }

      const call = browserRequest.postDataJSON() as {
        args?: { methodID?: number; methodName?: string; args?: unknown[] };
      } | null;
      if (call?.args?.args?.[0] !== pluginID) {
        return;
      }

      const method = call.args.methodID === undefined
        ? call.args.methodName?.split('.').at(-1)
        : schemaMethodIDs.get(call.args.methodID);
      if (method && schemaMethods.includes(method)) {
        browserSchemaCalls.push(method);
      }
    };

    page.on('request', observeBrowserSchemaCall);

    try {
      for (const { connection, type, operations } of probes) {
        const route = { connection };
        await test.step(`${connection}: browsing connects without demanding schemas`, async () => {
          await connectThroughBrowser(page, request, connection);
          expect(browserSchemaCalls, 'resource navigation does not resolve schemas').toEqual([]);
        });

        const catalog = await callBinding<Catalog>(request, Service.resource, 'Catalog', pluginID, { route });
        const descriptor = catalog.types.find(entry => entry.type === type);
        expect(descriptor, 'the route advertises its resource type').toBeDefined();
        const native = descriptor?.representations.find(entry => entry.id === 'native');
        const authoring = descriptor?.representations.find(entry => entry.id === 'authoring');
        if (!native || !authoring) {
          throw new Error(`${connection}: native and authoring representations are required`);
        }

        const nativeRequest: SchemaRequest = { route, type, target: { representation: native } };
        const authoringRequest: SchemaRequest = { route, type, target: { representation: authoring } };
        authoringRequests.set(connection, authoringRequest);

        await test.step(`${connection}: native field discovery stays absent and dynamic`, async () => {
          const fields = await callBinding<SchemaFieldsResult>(request, Service.resource, 'GetSchemaFields', pluginID, { request: nativeRequest, path: [] });
          const editor = await callBinding<EditorSchemaResult>(request, Service.resource, 'ResolveEditorSchema', pluginID, nativeRequest);
          facts.push({ step: 'native schema', connection, fields, editor });
          expect(fields).toMatchObject({ type, target: nativeRequest.target, schemaState: 'absent', truncated: false });
          expect(fields.observation).not.toBe('');
          expect(fields.schemaRevision).toBeUndefined();
          expect(fields.dialect).toBeUndefined();
          expect(fields.truncationReason).toBeUndefined();
          expect(fields.fields).toEqual([]);
          expect(fields.overlay).toMatchObject({
            Operations: operations,
            NativeQueryLanguages: [],
            HostEvaluation: 'dynamic',
            HostEvaluationCode: '',
            Validation: 'none',
          });
          expect(editor).toMatchObject({ type, target: nativeRequest.target, status: 'absent', observation: fields.observation });
          expect(editor.schemaRevision).toBeUndefined();
          expect(editor.document).toBeUndefined();
          expect(editor.root).toBeUndefined();
          expect(editor.code).toBeUndefined();
        });

        await test.step(`${connection}: authoring fields and editor resolve the same schema`, async () => {
          const fields = await callBinding<SchemaFieldsResult>(request, Service.resource, 'GetSchemaFields', pluginID, { request: authoringRequest, path: [] });
          const hardware = await callBinding<SchemaFieldsResult>(request, Service.resource, 'GetSchemaFields', pluginID, {
            request: authoringRequest, path: [{ Kind: 'field', Name: 'hardware' }],
          });
          const editor = await callBinding<EditorSchemaResult>(request, Service.resource, 'ResolveEditorSchema', pluginID, authoringRequest);
          facts.push({ step: 'authoring schema', connection, fields, hardware, editor });
          expect(fields).toMatchObject({ type, target: authoringRequest.target, schemaState: 'available', truncated: false });
          expect(fields.schemaRevision).toBeTruthy();
          expect(fields.fields.map(field => field.Segment.Name).sort()).toEqual(['hardware', 'name', 'state', 'tags']);
          expect(fields.fields.find(field => field.Segment.Name === 'state')?.Enum).toEqual([
            { kind: 'string', value: 'running' }, { kind: 'string', value: 'stopped' },
          ]);
          expect(hardware.observation).toBe(fields.observation);
          expect(hardware.fields).toEqual([
            expect.objectContaining({ Segment: { Kind: 'field', Name: 'cores' }, Types: ['integer'] }),
          ]);
          expect(editor).toMatchObject({
            type, target: authoringRequest.target, status: 'available',
            observation: fields.observation, schemaRevision: fields.schemaRevision, dialect: fields.dialect,
          });
          expect(editor.document?.schema).toBeDefined();
          expect(editor.root).toBeTruthy();
          expect(editor.code).toBeUndefined();

          const nativeAgain = await callBinding<SchemaFieldsResult>(request, Service.resource, 'GetSchemaFields', pluginID, { request: nativeRequest, path: [] });
          expect(nativeAgain).toMatchObject({ target: nativeRequest.target, schemaState: 'absent', fields: [] });
          expect(nativeAgain.schemaRevision).toBeUndefined();
          const nativeEditor = await callBinding<EditorSchemaResult>(request, Service.resource, 'ResolveEditorSchema', pluginID, nativeRequest);
          expect(nativeEditor.status).toBe('absent');
          expect(nativeEditor.document).toBeUndefined();
        });

        await test.step(`${connection}: unknown targets and unreferenced documents stay isolated`, async () => {
          const otherType = probes.find(probe => probe.type !== type)?.type;
          const missingType = await rejection(callBinding(request, Service.resource, 'ResolveEditorSchema', pluginID, { ...authoringRequest, type: otherType }));
          expect(missingType.code).toBe('NOT_FOUND');
          const stale = await rejection(callBinding(request, Service.resource, 'ResolveEditorSchema', pluginID, {
            ...authoringRequest, target: { representation: { ...authoring, revision: `${authoring.revision}-stale` } },
          }));
          expect(stale.code).toBe('RESET_REQUIRED');
          const missingRepresentation = await rejection(callBinding(request, Service.resource, 'ResolveEditorSchema', pluginID, {
            ...authoringRequest, target: { representation: { id: 'p07-e2e/missing', revision: '1' } },
          }));
          expect(missingRepresentation.code).toBe('NOT_FOUND');
          const documents = [];
          for (const schemaRequest of [nativeRequest, authoringRequest]) {
            const document = await rejection(callBinding(request, Service.resource, 'GetSchemaDocument', pluginID, {
              request: schemaRequest, reference: unreferencedSchemaDocument,
            }));
            expect(document.code).toBe('NOT_FOUND');
            documents.push({ target: schemaRequest.target, document });
          }

          facts.push({ step: 'target rejection', connection, missingType, stale, missingRepresentation, documents });
        });
      }

      await test.step('a representation revision from another route cannot select its schema', async () => {
        const selected = [...authoringRequests.values()];
        for (const [index, schemaRequest] of selected.entries()) {
          const foreign = selected[(index + 1) % selected.length];
          const result = await rejection(callBinding(request, Service.resource, 'ResolveEditorSchema', pluginID, {
            ...schemaRequest, target: foreign.target,
          }));
          expect(result.code).toBe('RESET_REQUIRED');
          facts.push({ step: 'foreign route revision', connection: schemaRequest.route.connection, result });
        }
      });
      expect(browserSchemaCalls, 'browsing never demands schemas, including after explicit API enrichment').toEqual([]);
    } finally {
      page.off('request', observeBrowserSchemaCall);
      console.log(`[schema-catalog] ${JSON.stringify(facts)}`);
      await testInfo.attach('schema-catalog-facts.json', { body: JSON.stringify({ facts, browserSchemaCalls }, null, 2), contentType: 'application/json' });
    }
  });
});
