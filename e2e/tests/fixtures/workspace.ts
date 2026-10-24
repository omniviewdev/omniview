import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';

export type Descriptor = {
  schemaVersion: number; workspaceID: string; instanceID: string; generation: string;
  kind: string; displayName: string; stateRoot: string; readiness: string;
  process: { pid: number; startIdentity: string; executable: string; workspaceID: string; generation: string; role: string; source: string };
  endpoints: { browser: string | null; vite: string | null; hmr: string | null; control: string | null; mcp: string | null };
  plugins: Array<{ id: string; source: string; generation: string; mode: string; buildStatus: string; viteStatus: string; rpcStatus: string; controllerStatus: string }>;
};
export type SettingSelection = { scope: 'host' | 'plugin'; pluginID?: string; id: string };
type WireDescriptor = Omit<Descriptor, 'plugins'> & { plugins: Descriptor['plugins'] | null };
export type Status = { manifest: { workspaceID: string }; stateRoot: string; launchPhase: string; instance?: WireDescriptor };
type Response = { status: string; workspaceID: string; generation: string; result: WireDescriptor; error?: { code: string } };
type Selection = { workspaceID: string; generation: string };
const execute = promisify(execFile);
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for explicit read-only observation`);
  }

  return value;
}

function loopback(endpoint: string | null, path: string): string {
  if (!endpoint) {
    throw new Error('Observed descriptor has no required endpoint');
  }

  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== path) {
    throw new Error('Observed descriptor endpoint is not canonical loopback');
  }

  return url.href;
}

export function validateObservation(status: Status, response: Response, expected: Selection, previous?: Descriptor): Descriptor {
  const actual = response.result;
  const advertised = status.instance;
  const browserBackendReady = actual?.readiness === 'backend-ready' && typeof actual.endpoints.browser === 'string' && actual.endpoints.browser === advertised?.endpoints.browser;
  if (Boolean(response.error) || response.status !== 'succeeded' || status.launchPhase !== 'ready' || !advertised || actual?.schemaVersion !== 1 || actual.kind !== 'development' || (!['ready', 'host-ready'].includes(actual.readiness) && !browserBackendReady) || actual.workspaceID !== status.manifest.workspaceID || actual.stateRoot !== status.stateRoot || actual.workspaceID !== response.workspaceID || actual.generation !== response.generation) {
    throw new Error('Workspace is not an authenticated ready development host');
  }

  if (actual.workspaceID !== expected.workspaceID || actual.generation !== expected.generation) {
    throw new Error('Refusing a different observational UUID/generation');
  }

  for (const key of ['workspaceID', 'instanceID', 'generation', 'stateRoot'] as const) {
    if (actual[key] !== advertised[key] || (previous && actual[key] !== previous[key])) {
      throw new Error(`Observed descriptor ${key} changed`);
    }
  }

  if (!actual.process.startIdentity || JSON.stringify(actual.process) !== JSON.stringify(advertised.process) || JSON.stringify(actual.endpoints) !== JSON.stringify(advertised.endpoints)) {
    throw new Error('Authenticated process/endpoints differ from supervisor readiness');
  }

  loopback(actual.endpoints.control, '/v1/control');
  loopback(actual.endpoints.browser, '/');
  return { ...actual, plugins: actual.plugins ?? [] };
}

/** No mutation, source editing, launch, reset, cleanup or ambient-server adoption. */
class ObservationalWorkspace {
  private descriptor?: Descriptor;
  private readonly root: string;
  private readonly target: string;
  private readonly expected: Selection;
  constructor(root: string, target: string, expected: Selection) {
    this.root = root;
    this.target = target;
    this.expected = expected;
  }

  async verify(): Promise<Descriptor> {
    const status = await this.read<Status>(['workspace', 'inspect']);
    const response = await this.read<Response>(['instance', 'inspect']);
    this.descriptor = validateObservation(status, response, this.expected, this.descriptor);
    return this.descriptor;
  }

  browserURL(): string {
    if (!this.descriptor) {
      throw new Error('Authenticate observation before navigating');
    }

    return loopback(this.descriptor.endpoints.browser, '/');
  }

  private async read<T>(command: string[]): Promise<T> {
    const binary = required('OMNIVIEW_E2E_CLI');
    if (!isAbsolute(binary)) {
      throw new Error('Observation requires an explicit built CLI executable');
    }

    const env = { ...process.env, GOWORK: 'off', GOFLAGS: '' };
    for (const key of Object.keys(env)) {
      if (key.startsWith('OMNIVIEW_') || key.startsWith('WAILS_') || ['GO_MODFILE', 'NODE_PATH', 'FRONTEND_DEVSERVER_URL'].includes(key)) {
        Reflect.deleteProperty(env, key);
      }
    }

    const { stdout } = await execute(binary, [...command, '--root', this.root, '--workspace', this.target, '--json'], { env, timeout: 30_000, maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout) as T;
  }
}
export function observationalWorkspace(): ObservationalWorkspace {
  return new ObservationalWorkspace(required('OMNIVIEW_E2E_ROOT'), required('OMNIVIEW_E2E_WORKSPACE'), { workspaceID: required('OMNIVIEW_E2E_WORKSPACE_ID'), generation: required('OMNIVIEW_E2E_GENERATION') });
}
