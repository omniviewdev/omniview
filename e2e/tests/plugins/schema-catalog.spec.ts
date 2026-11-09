import { createHash } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { test as base, expect } from '../fixtures/app.fixture';
import { goTo } from '../fixtures/helpers';
import { callBinding, Service } from '../fixtures/wails';
import type { EditorSchemaAssociation, SchemaFieldsResult } from '../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/models';

/**
 * Real-application evidence for the host resource schema catalog on provider-neutral connections
 * (issue #85).
 *
 * The workspace probe's Go provider serves four fixed connections: cloud, container, hypervisor and a
 * Kubernetes-shaped fixture. Each advertises one type whose native representation declares
 * `Schema: {State: "absent"}`. A separate authoring representation offers a schema; it must not
 * contaminate the native representation. Nothing between the provider and these assertions is simulated: each
 * connection is started through the browser's own Connect action, and the host's resource service
 * answers over its real runtime endpoint from the catalog it admitted from the plugin process over gRPC.
 *
 * What the catalog must report for every connection:
 * - field discovery: schema state `absent`, no schema revision or dialect, no fields, and an overlay
 *   that evaluates dynamically with no validation and no native query languages;
 * - editor associations: one native association for the type, `absent`, with no document, bound to a model
 *   directory derived from the plugin, connection, type and representation, so no two connections share
 *   one;
 * - documents: an editor document or raw schema document nothing in the connection's catalog
 *   references is `NOT_FOUND`, never served from another connection's catalog.
 */

const pluginID = 'workspace-probe';
// Connection lifecycle runs through the backend, the module transport and React: allow for it.
const lifecycle = { timeout: 15_000 };
// The SDK controller frames the provider's catalog revision under its connection's client slot: an opaque
// `ovc1.<nonce>.<digest>` token (32 bytes each, base64url) that only a real SDK child process issues.
const boundCatalogRevision = /^ovc1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;
// Each fixed probe connection with the one type its catalog advertises, and the operations that type declares.
type Probe = { connection: string; type: string; operations: string[] };
const probes: Probe[] = [
  { connection: 'cloud-bundled-pages', type: 'compute/instance', operations: ['enumerate', 'get'] },
  { connection: 'container-bundled-events', type: 'container', operations: ['enumerate', 'get', 'sourceUpdates'] },
  { connection: 'hypervisor-bundled-vms', type: 'vm', operations: ['enumerate', 'get'] },
  { connection: 'kubernetes-snapshot', type: 'core::v1::Pod', operations: ['enumerate', 'get'] },
];
// A digest-shaped editor document id and a schema document reference that no probe catalog contains.
const unreferencedEditorDocument = createHash('sha256').update('p07-e2e/unreferenced-editor-document').digest('hex');
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
  test('a provider that declares no schema stays absent, dynamic and isolated on every connection', async ({ appPage: page, request }, testInfo) => {
    // Four real connection starts, each followed by four host calls over gRPC.
    test.slow();
    const facts: Array<Record<string, unknown>> = [];
    const directories = new Map<string, string>();
    const fileMatches = new Map<string, string>();

    try {
      for (const { connection, type, operations } of probes) {
        const route = { connection };

        await test.step(`${connection}: start the connection through the browser`, async () => {
          await connectThroughBrowser(page, request, connection);
        });

        await test.step(`${connection}: field discovery reports an absent schema and a dynamic overlay`, async () => {
          const result = await callBinding<SchemaFieldsResult>(request, Service.resource, 'GetSchemaFields', pluginID, { route, type, path: [] });
          facts.push({ step: 'schema fields', connection, result });
          expect(result.catalogRevision, 'the catalog the host observed carries the SDK child\'s client-bound revision').toMatch(boundCatalogRevision);
          expect(result).toMatchObject({ type, representation: 'native', schemaState: 'absent', truncated: false });
          expect(result.schemaRevision).toBeUndefined();
          expect(result.dialect).toBeUndefined();
          expect(result.truncationReason).toBeUndefined();
          expect(result.fields).toEqual([]);
          // The overlay carries its Go field names: the host's TypeOverlay declares no JSON tags.
          expect(result.overlay).toMatchObject({
            Operations: operations,
            NativeQueryLanguages: [],
            HostEvaluation: 'dynamic',
            HostEvaluationCode: '',
            Validation: 'none',
          });
        });

        await test.step(`${connection}: the editor association is absent and bound to its own model directory`, async () => {
          const associations = await callBinding<EditorSchemaAssociation[]>(request, Service.resource, 'GetEditorSchemas', pluginID, route);
          facts.push({ step: 'editor associations', connection, associations });
          const catalogAssociations = associations.filter((association) => association.type !== '' && association.representation === 'native');
          expect(catalogAssociations).toHaveLength(1);
          const [association] = catalogAssociations;
          expect(association).toMatchObject({ type, representation: 'native', language: 'yaml', status: 'absent' });
          expect(association.documentId).toBeUndefined();
          expect(association.root).toBeUndefined();
          expect(association.code).toBeUndefined();
          expect(association.key).toBeUndefined();
          expect(association.modelDirectory).toMatch(/^file:\/\/\/omniview-schema\/[0-9a-f]{16}$/);
          expect(association.fileMatch).toMatch(/^\*\*\/omniview-schema\/[0-9a-f]{16}\/\*$/);
          // The directory is the first 16 hex digits of sha256 over the plugin, connection, type and representation.
          const hex16 = createHash('sha256').update(['omniview.editor.v1', pluginID, connection, type, 'native'].join('\0')).digest('hex').slice(0, 16);
          expect(association.modelDirectory).toBe(`file:///omniview-schema/${hex16}`);
          expect(association.fileMatch).toBe(`**/omniview-schema/${hex16}/*`);
          // A provider without auxiliary editor schemas adds at most the host's unavailable placeholder: no type, no directory.
          const auxiliary = associations.filter((entry) => entry.type === '');
          expect(auxiliary.length).toBeLessThanOrEqual(1);
          for (const entry of auxiliary) {
            expect(entry).toMatchObject({ language: 'yaml', modelDirectory: '', fileMatch: '', status: 'unavailable', code: 'UNSUPPORTED' });
            expect(entry.key).toBeUndefined();
            expect(entry.documentId).toBeUndefined();
          }

          directories.set(connection, association.modelDirectory);
          fileMatches.set(connection, association.fileMatch);
        });

        await test.step(`${connection}: documents nothing in the catalog references are NOT_FOUND`, async () => {
          const editor = await rejection(callBinding(request, Service.resource, 'GetEditorSchemaDocument', pluginID, route, unreferencedEditorDocument));
          const schema = await rejection(callBinding(request, Service.resource, 'GetSchemaDocument', pluginID, route, unreferencedSchemaDocument));
          facts.push({ step: 'unreferenced documents', connection, editorDocument: editor, schemaDocument: schema });
          expect(editor.code, 'an editor document no association of this connection references').toBe('NOT_FOUND');
          expect(schema.code, 'a schema document reference no binding of the fresh catalog uses').toBe('NOT_FOUND');
        });
      }

      await test.step('editor isolation: no two connections share a model directory', async () => {
        expect([...directories.keys()]).toEqual(probes.map(({ connection }) => connection));
        expect(new Set(directories.values()).size).toBe(probes.length);
        expect(new Set(fileMatches.values()).size).toBe(probes.length);
        facts.push({ step: 'editor isolation', directories: Object.fromEntries(directories) });
      });
    } finally {
      console.log(`[schema-catalog] ${JSON.stringify(facts)}`);
      await testInfo.attach('schema-catalog-facts.json', { body: JSON.stringify(facts, null, 2), contentType: 'application/json' });
    }
  });
});
