import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const deadline = 25 * 60_000;
const ownedHomes = new Map<string, string>();
export type Descriptor = {
  schemaVersion: number; workspaceID: string; instanceID: string; generation: string;
  kind: string; displayName: string; stateRoot: string; readiness: string;
  process: { pid: number; startIdentity: string; executable: string; workspaceID: string; generation: string; role: string; source: string };
  endpoints: { browser: string | null; vite: string | null; hmr: string | null; control: string | null; mcp: string | null };
  plugins: Array<{
    id: string; source: string; generation: string; mode: string;
    buildStatus: string; viteStatus: string; rpcStatus: string; controllerStatus: string;
    lastError?: { code: string; message: string };
  }>;
};
export type Status = {
  manifest: { workspaceID: string; plugins: Array<{ id: string; repositoryID: string; mode: string }> };
  root: string; stateRoot: string; launchPhase: string; generation?: string; instance?: Descriptor;
  builds?: Record<string, { node: string; phase: string; error?: string }>;
  lastError?: { code: string; message: string };
};
export type ProfileOptions = {
  liveFrontend?: boolean;
  watch?: boolean;
  prepare?: (workspace: Workspace) => Promise<void>;
};
type Response<T = unknown> = { protocolVersion: number; requestID: string; workspaceID: string; generation: string; status: string; result: T; error?: { code: string } };
type Sources = { sources: Record<string, string>; refs: Record<string, string>; repositories: string[]; plugins?: string[]; reviewedSDKRevision: string; linkEvidence: string; liveFrontend?: boolean };
type LinkEvidence = { protocol: string; versions: string[]; atomicDist: boolean; peers: boolean; runtime: boolean };
type CompositionReceipt = {
  schemaVersion: number; workspaceID: string; root: string; phase: string; evidence: LinkEvidence;
  plan: { composition?: { schemaVersion: number; workspaceID: string; root: string; version: string } };
  files: Array<{ path: string; appliedHash: string; pending?: boolean }>;
};

function hasNative12LinkEvidence(value: unknown): value is LinkEvidence {
  return !!value && typeof value === 'object' &&
    'protocol' in value && value.protocol === 'workspace' &&
    'versions' in value && Array.isArray(value.versions) && value.versions.length === 1 && value.versions[0] === '12.14.0' &&
    'atomicDist' in value && value.atomicDist === true &&
    'peers' in value && value.peers === true &&
    'runtime' in value && value.runtime === true;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required; see the A17 harness instructions`);
  }

  return value;
}

function environment(args: string[]): NodeJS.ProcessEnv {
  // An enclosing human workspace must never select our profile or module graph.
  const env: NodeJS.ProcessEnv = { ...process.env, GOWORK: 'off' };
  const root = args[args.indexOf('--root') + 1];
  const home = ownedHomes.get(root);
  if (home) {
    env.HOME = home;
  } else if (process.env.OMNIVIEW_E2E_MODE !== 'observe') {
    throw new Error('Owned CLI commands require a registered private collection and HOME');
  }

  for (const key of Object.keys(env)) {
    if (key.startsWith('OMNIVIEW_') || key.startsWith('WAILS_') || key.startsWith('GIT_') || ['pnpm_config_workspace_dir', 'npm_config_workspace_dir'].includes(key.toLowerCase()) || ['GOFLAGS', 'GO_MODFILE', 'NODE_PATH', 'FRONTEND_DEVSERVER_URL'].includes(key)) {
      Reflect.deleteProperty(env, key);
    }
  }

  const nativePnpm = process.env.OMNIVIEW_E2E_PNPM_EXECUTABLE;
  if (nativePnpm) {
    if (!isAbsolute(nativePnpm)) {
      throw new Error('OMNIVIEW_E2E_PNPM_EXECUTABLE must identify an absolute private native pnpm12 executable');
    }

    env.OMNIVIEW_PNPM_EXECUTABLE = nativePnpm;
  }

  return env;
}

export async function cli<T>(args: string[]): Promise<T> {
  const binary = requireEnvironment('OMNIVIEW_E2E_CLI');
  if (!isAbsolute(binary)) {
    throw new Error('OMNIVIEW_E2E_CLI must be an absolute built executable (not go run)');
  }

  try {
    const { stdout } = await execute(binary, [...args, '--json'], { env: environment(args), timeout: deadline, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout) as T;
  } catch (error) {
    // Do not relay arbitrary build/plugin stdout, token-bearing environment or logs.
    const failure = error as { code?: unknown; stdout?: string };
    let code: unknown;
    try {
      code = JSON.parse(failure.stdout ?? '{}').error?.code;
    } catch { /* report only exit status */ }

    const status = code ?? failure.code;
    const diagnostic = typeof status === 'string' || typeof status === 'number' ? status : 'invalid JSON';
    throw new Error(`Owned workspace CLI ${args.slice(0, 2).join(' ')} failed (${diagnostic}); private collection retained for inspect/down`);
  }
}

function loopback(endpoint: string | null, path?: string): string {
  if (!endpoint) {
    throw new Error('Descriptor does not advertise the required endpoint');
  }

  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || (path && url.pathname !== path)) {
    throw new Error('Refusing non-loopback or credential-bearing descriptor endpoint');
  }

  return url.href;
}

async function privateFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
    throw new Error('Discovery and token must be private regular files');
  }

  if (process.getuid && info.uid !== process.getuid()) {
    throw new Error('Discovery or token belongs to a different user');
  }

  return readFile(path);
}

type ExpectedDescriptor = Pick<Descriptor, 'workspaceID' | 'generation'>;
type SelectionMode = 'verify' | 'reselect' | 'restart';

function validateAuthenticatedDescriptor(status: Status, response: Response<Descriptor>): Descriptor {
  const actual = response.result;
  const advertised = status.instance;
  const browserBackendReady = actual?.readiness === 'backend-ready' && typeof actual.endpoints.browser === 'string' && actual.endpoints.browser === advertised?.endpoints.browser;
  const runtimeReady = ['ready', 'host-ready'].includes(actual?.readiness) || browserBackendReady;
  if (Boolean(response.error) || response.status !== 'succeeded' || status.launchPhase !== 'ready' || !advertised || actual.schemaVersion !== 1 || actual.kind !== 'development' || !runtimeReady || actual.workspaceID !== status.manifest.workspaceID || actual.stateRoot !== status.stateRoot || actual.workspaceID !== response.workspaceID || actual.generation !== response.generation) {
    throw new Error(`Workspace is not an authenticated ready development host (launch=${status.launchPhase}, host=${actual?.readiness}, control=${response.status}, code=${response.error?.code ?? 'none'})`);
  }

  for (const key of ['workspaceID', 'instanceID', 'generation', 'stateRoot'] as const) {
    if (actual[key] !== advertised[key]) {
      throw new Error(`Descriptor ${key} changed during readiness check`);
    }
  }

  if (JSON.stringify(actual.process) !== JSON.stringify(advertised.process) || JSON.stringify(actual.endpoints) !== JSON.stringify(advertised.endpoints)) {
    throw new Error('Authenticated process/endpoints differ from supervisor readiness');
  }

  loopback(actual.endpoints.control, '/v1/control');
  return actual;
}

function validateDescriptorSelection(candidate: Descriptor, expected: ExpectedDescriptor | undefined, previous: Descriptor | undefined, mode: SelectionMode): void {
  if (expected && (candidate.workspaceID !== expected.workspaceID || candidate.generation !== expected.generation)) {
    throw new Error('Refusing a different observational UUID/generation');
  }

  if (!previous) {
    return;
  }

  const sameProfile = candidate.workspaceID === previous.workspaceID && candidate.instanceID === previous.instanceID;
  if (mode === 'verify' && (!sameProfile || candidate.generation !== previous.generation)) {
    throw new Error('Instance generation changed; reselect explicitly before any mutation');
  }

  if (mode === 'reselect' && !sameProfile) {
    throw new Error('Reselection refused a different owned profile');
  }

  if (mode === 'restart' && (!sameProfile || candidate.generation === previous.generation)) {
    throw new Error('Restart did not preserve profile and rotate generation');
  }
}

function validateCompositionReceipt(receipt: CompositionReceipt, descriptor: Descriptor, root: string, advertisedRoot: string): void {
  const composition = receipt.plan?.composition;
  if (root !== advertisedRoot || receipt.schemaVersion !== 2 || receipt.workspaceID !== descriptor.workspaceID || receipt.root !== root || receipt.phase !== 'linked' || !composition || composition.workspaceID !== descriptor.workspaceID || composition.root !== root || composition.version !== '12.14.0' || !hasNative12LinkEvidence(receipt.evidence) || !Array.isArray(receipt.files) || receipt.files.some(file => file.pending)) {
    throw new Error('Ready workspace has no complete native12 composition receipt');
  }
}

async function validateOwnedComposition(status: Status, descriptor: Descriptor): Promise<void> {
  const root = await realpath(status.root);
  const receipt = JSON.parse((await privateFile(join(root, '.local', 'links.json'))).toString()) as CompositionReceipt;
  validateCompositionReceipt(receipt, descriptor, root, status.root);
  for (const name of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    const records = receipt.files.filter(file => file.path === name);
    const generated = join(root, name);
    const info = await lstat(generated);
    if (records.length !== 1 || info.isSymbolicLink() || !info.isFile() || createHash('sha256').update(await readFile(generated)).digest('hex') !== records[0].appliedHash) {
      throw new Error('Aggregate workspace files differ from the completed native12 transaction');
    }
  }
}

export class Workspace {
  descriptor: Descriptor | undefined;
  readonly root: string;
  readonly target: string;
  readonly owned: boolean;
  readonly expected?: ExpectedDescriptor;
  private readonly edits = new Map<string, { before: Uint8Array | null; mode: number; current: Uint8Array }>();

  constructor(root: string, target: string, owned: boolean, expected?: ExpectedDescriptor) {
    this.root = root;
    this.target = target;
    this.owned = owned;
    this.expected = expected;
  }

  selection(): string[] {
    return ['--root', this.root, '--workspace', this.target]; 
  }

  browserURL(): string {
    if (!this.descriptor) {
      throw new Error('Select an authenticated ready descriptor before opening the browser');
    }

    return loopback(this.descriptor.endpoints.browser);
  }

  async status(): Promise<Status> {
    return cli<Status>(['workspace', 'inspect', ...this.selection()]);
  }

  async repository(id: string): Promise<string> {
    this.assertOwned();
    const paths = await cli<{ workspaceID: string; repositories: Record<string, string> }>(['workspace', 'paths', ...this.selection()]);
    const status = await this.status();
    const path = paths.repositories[id];
    if (paths.workspaceID !== status.manifest.workspaceID || Boolean(this.descriptor && paths.workspaceID !== this.descriptor.workspaceID) || !path) {
      throw new Error(`Repository ${id} is not selected in this owned workspace`);
    }

    const target = await realpath(this.target);
    const canonical = await realpath(path);
    const inside = relative(target, canonical);
    if (target !== this.target || canonical !== path || !inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw new Error('Source mutation must stay inside an authoritative harness-owned feature worktree');
    }

    return canonical;
  }

  async editSource(repository: string, path: string, transform: (source: string) => string): Promise<void> {
    this.assertOwned();
    const status = await this.status();
    if (this.descriptor && status.generation !== this.descriptor.generation) {
      throw new Error('Reselect the new generation explicitly before editing source');
    }

    const selected = await this.sourcePath(repository, path);
    let before: Uint8Array | null = null;
    let mode = 0o600;
    try {
      before = await readFile(selected); mode = (await lstat(selected)).mode & 0o777; 
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const previous = this.edits.get(selected);
    // The journal stores byte arrays; retain Buffer's byte comparison and UTF-8
    // decoding through a concrete zero-copy view of the bytes read from disk.
    const original = before === null ? undefined : Buffer.from(before.buffer, before.byteOffset, before.byteLength);
    if (previous && !original?.equals(previous.current)) {
      throw new Error('Acceptance source changed outside its owned edit journal');
    }

    const current = Buffer.from(transform(original?.toString() ?? ''));
    // Record intent before writing: a failed write must never permit dirty removal.
    this.edits.set(selected, { before: previous ? previous.before : before, mode: previous?.mode ?? mode, current });
    await writeFile(selected, current, { mode, flag: before ? 'w' : 'wx' });
  }

  async restoreSources(): Promise<void> {
    this.assertOwned();
    const status = await this.status();
    if (status.launchPhase !== 'stopped') {
      throw new Error('Source restoration requires proven owned workspace down');
    }

    for (const [path, edit] of [...this.edits].reverse()) {
      if (await realpath(this.target) !== this.target || await realpath(dirname(path)) !== dirname(path)) {
        throw new Error('Owned source restoration refused a redirected feature worktree');
      }

      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || !Buffer.from(await readFile(path)).equals(edit.current)) {
        throw new Error('Owned source restoration refused a foreign edit; private feature worktree retained');
      }

      if (edit.before === null) {
        await unlink(path);
      } else {
        await writeFile(path, edit.before); await chmod(path, edit.mode); 
      }

      this.edits.delete(path);
    }
  }

  async reselect(): Promise<Descriptor> {
    this.assertOwned();
    return this.selectDescriptor('reselect');
  }

  async verify(): Promise<Descriptor> {
    return this.selectDescriptor('verify');
  }

  assertOwned(): void {
    if (!this.owned) {
      throw new Error('Settings resets, terminal cleanup and lifecycle mutation are forbidden on observational attachment');
    }
  }

  async restart(): Promise<Descriptor> {
    this.assertOwned();
    const previous = await this.verify();
    await cli(['workspace', 'restart', ...this.selection(), '--timeout', '20m']);
    return this.selectDescriptor('restart', previous);
  }

  async control(operation: string, params: unknown, target: Partial<{ workspaceID: string; generation: string }> = {}): Promise<Response> {
    this.assertOwned();
    const descriptor = await this.verify();
    // Custom persistent state roots do not relocate the UUID-owned transient
    // runtime. Ask the actual workspace resolver; never inspect an adjacent tree.
    const paths = await cli<{ workspaceID: string; stateRoot: string; runtimeRoot: string }>(['workspace', 'paths', ...this.selection()]);
    if (paths.workspaceID !== descriptor.workspaceID || paths.stateRoot !== descriptor.stateRoot || typeof paths.runtimeRoot !== 'string' || !isAbsolute(paths.runtimeRoot)) {
      throw new Error('Authoritative runtime paths do not match the selected profile');
    }

    const runtime = await realpath(paths.runtimeRoot);
    const directory = await lstat(runtime);
    if (runtime !== paths.runtimeRoot || !directory.isDirectory() || (process.platform !== 'win32' && (directory.mode & 0o077) !== 0) || (process.getuid && directory.uid !== process.getuid())) {
      throw new Error('Authoritative runtime root must be a canonical owned private directory');
    }

    const discovery = JSON.parse((await privateFile(join(runtime, 'discovery.json'))).toString()) as Descriptor & { tokenFile: string };
    const hash = createHash('sha256').update(`${descriptor.workspaceID}\0${descriptor.generation}`).digest('hex');
    if (discovery.workspaceID !== descriptor.workspaceID || discovery.instanceID !== descriptor.instanceID || discovery.generation !== descriptor.generation || discovery.stateRoot !== descriptor.stateRoot || JSON.stringify(discovery.process) !== JSON.stringify(descriptor.process) || JSON.stringify(discovery.endpoints) !== JSON.stringify(descriptor.endpoints) || discovery.tokenFile !== join(runtime, `control-token-${hash}.secret`)) {
      throw new Error('Private discovery changed before control call');
    }

    const token = await privateFile(discovery.tokenFile);
    if (token.length < 32) {
      throw new Error('Invalid control token');
    }

    const requestID = randomUUID();
    // Node fetch deliberately stays outside Playwright tracing/HAR. Never attach
    // Authorization, token files, request headers or raw private discovery.
    const response = await fetch(loopback(descriptor.endpoints.control, '/v1/control'), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
      headers: { Authorization: `Bearer ${token.toString()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, requestID, workspaceID: target.workspaceID ?? descriptor.workspaceID, generation: target.generation ?? descriptor.generation, operation, params }),
    });
    const result = await response.json() as Response;
    if (result.protocolVersion !== 1 || result.workspaceID !== descriptor.workspaceID || result.generation !== descriptor.generation || (result.requestID && result.requestID !== requestID)) {
      throw new Error('Control response identity mismatch');
    }

    return result;
  }

  private async sourcePath(repository: string, path: string): Promise<string> {
    if (!path || isAbsolute(path) || path.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || /(?:^|\/)(?:node_modules|dist|build|bin|vendor)(?:\/|$)/.test(path)) {
      throw new Error('Acceptance edits must name ordinary source files, not metadata or generated outputs');
    }

    const root = await this.repository(repository);
    const selected = join(root, path);
    if (await realpath(dirname(selected)) !== dirname(selected)) {
      throw new Error('Acceptance source parent is redirected');
    }

    try {
      const info = await lstat(selected);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error('Acceptance source must be a regular file');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return selected;
  }

  private async selectDescriptor(mode: SelectionMode, previous = this.descriptor): Promise<Descriptor> {
    // Keep the last selection usable until every candidate check succeeds.
    // The CLI proves kernel process ownership and authenticates instance.inspect.
    const status = await this.status();
    const response = await cli<Response<Descriptor>>(['instance', 'inspect', ...this.selection()]);
    const candidate = validateAuthenticatedDescriptor(status, response);
    validateDescriptorSelection(candidate, this.expected, previous, mode);
    if (this.owned) {
      await validateOwnedComposition(status, candidate);
    }

    this.descriptor = candidate;
    return candidate;
  }
}

export class OwnedProfiles {
  static async create(): Promise<OwnedProfiles> {
    const sources = JSON.parse(await readFile(requireEnvironment('OMNIVIEW_E2E_SOURCES'), 'utf8')) as Sources;
    if (!sources.sources?.omniview || !sources.sources?.['plugin-sdk'] || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sources.reviewedSDKRevision) || !isAbsolute(sources.linkEvidence) || !Array.isArray(sources.repositories)) {
      throw new Error('Explicit host/SDK sources, repositories, full reviewed SDK revision and absolute link evidence are required');
    }

    for (const [id, path] of Object.entries(sources.sources)) {
      if (!isAbsolute(path) || !sources.refs?.[id]) {
        throw new Error(`Explicit absolute source and committed ref required for ${id}`);
      }
    }

    const evidence: unknown = JSON.parse(await readFile(sources.linkEvidence, 'utf8'));
    if (!hasNative12LinkEvidence(evidence)) {
      throw new Error('The actual native12 feature-workspace live-output and recursive-peer protocol evidence is required; independent-root evidence is not accepted');
    }

    const arena = await realpath(await mkdtemp(join(tmpdir(), 'omniview-e2e-')));
    const root = join(arena, 'collection');
    const home = join(arena, 'home');
    await mkdir(root, { mode: 0o700 });
    await mkdir(home, { mode: 0o700 });
    ownedHomes.set(root, home);
    const profiles = new OwnedProfiles(root, sources, await lstat(arena));
    await cli(['workspace', 'init', '--root', root, ...Object.entries(sources.sources).flatMap(([id, path]) => ['--source', `${id}=${path}`, '--source-ref', `${id}=${sources.refs[id]}`])]);
    return profiles;
  }

  readonly root: string;
  private readonly workspaces = new Map<string, Workspace>();
  private readonly sources: Sources;
  private readonly arenaIdentity: { dev: number; ino: number };
  private readonly modes = new Map<string, string>();
  private constructor(root: string, sources: Sources, arenaIdentity: { dev: number; ino: number }) {
    this.root = root;
    this.sources = sources;
    this.arenaIdentity = arenaIdentity;
  }

  async get(name: string, options: ProfileOptions = {}): Promise<Workspace> {
    const mode = JSON.stringify({ liveFrontend: options.liveFrontend ?? this.sources.liveFrontend === true, watch: options.watch ?? false });
    const existing = this.workspaces.get(name);
    if (existing) {
      if (this.modes.get(name) !== mode || options.prepare) {
        throw new Error('Owned profile options cannot change after creation');
      }

      await existing.verify(); return existing;
    }

    if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) {
      throw new Error('Invalid disposable profile name');
    }

    const created = await cli<{ root: string }>(['workspace', 'create', name, '--root', this.root, '--name', `E2E ${name}`, '--state-root', join(dirname(this.root), 'profiles', name, 'state'), ...this.sources.repositories.flatMap(id => ['--repo', id]), ...(this.sources.plugins ?? []).flatMap(id => ['--plugin', id])]);
    const workspace = new Workspace(this.root, created.root, true);
    // Register before startup so a timed-out launch still goes through owned down.
    this.workspaces.set(name, workspace);
    this.modes.set(name, mode);
    // Kubernetes's standalone default scans the human kubeconfig. The disposable
    // selected source instead exposes zero connections before any process starts.
    for (const plugin of (await workspace.status()).manifest.plugins) {
      if (plugin.id !== 'kubernetes') {
        continue;
      }

      await workspace.editSource(plugin.repositoryID, 'pkg/main.go', source => {
        const original = 'Default:     []string{"~/.kube/config"}';
        if (source.split(original).length !== 2) {
          throw new Error('Kubernetes safe startup prerequisite changed: cannot disable human kubeconfig discovery');
        }

        return source.replace(original, 'Default:     []string{}');
      });
    }

    await options.prepare?.(workspace);
    await cli(['workspace', 'up', ...workspace.selection(), '--mode', 'browser', `--watch=${options.watch ?? false}`, `--live-frontend=${options.liveFrontend ?? this.sources.liveFrontend === true}`, '--reviewed-sdk-revision', this.sources.reviewedSDKRevision, '--link-evidence', this.sources.linkEvidence, '--timeout', '20m']);
    await workspace.verify();
    return workspace;
  }

  async close(): Promise<void> {
    const failures: string[] = [];
    // Stop every producer before restoring any throwaway source. Failed down
    // never authorizes restoration, unlink, or native worktree removal.
    const stopped: Array<[string, Workspace]> = [];
    for (const [name, workspace] of [...this.workspaces].reverse()) {
      try {
        await cli(['workspace', 'down', ...workspace.selection(), '--timeout', '2m']); stopped.push([name, workspace]); 
      } catch {
        failures.push(name); 
      }
    }

    for (const [name, workspace] of stopped) {
      try {
        await workspace.restoreSources();
        await cli(['workspace', 'unlink', ...workspace.selection()]);
        await cli(['workspace', 'remove', ...workspace.selection(), '--delete-state', '--delete-branches']);
      } catch {
        failures.push(name); 
      }
    }

    // Never kill by port/PID, recursively remove worktrees, or bypass dirty refusal.
    if (failures.length) {
      throw new Error(`Owned cleanup refused for ${failures.join(', ')}; retained private collection ${this.root}; use workspace inspect/down/remove explicitly`);
    }

    await this.retireArena();
    ownedHomes.delete(this.root);
  }

  private async retireArena(): Promise<void> {
    const arena = dirname(this.root);
    const home = ownedHomes.get(this.root);
    const info = await lstat(arena);
    if (home !== join(arena, 'home') || !info.isDirectory() || info.isSymbolicLink() || info.dev !== this.arenaIdentity.dev || info.ino !== this.arenaIdentity.ino || (process.getuid !== undefined && info.uid !== process.getuid()) || (process.platform !== 'win32' && (info.mode & 0o077) !== 0) || await realpath(arena) !== arena) {
      throw new Error('Arena retirement refused a replaced or unowned private collection');
    }

    const homeInfo = await lstat(home);
    if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink() || homeInfo.uid !== info.uid || homeInfo.dev !== info.dev || await realpath(home) !== home) {
      throw new Error('Arena retirement refused a redirected private HOME');
    }

    // Go makes extracted module directories read-only. Only their owner needs
    // write/search permission for unlink; never chmod module files or follow
    // symlinks (which may reference a human cache outside this disposable HOME).
    const writableCacheDirectories = async (path: string): Promise<void> => {
      const before = await lstat(path);
      if (before.isSymbolicLink() || !before.isDirectory()) {
        return;
      }

      if (before.uid !== info.uid || before.dev !== info.dev || await realpath(path) !== path) {
        throw new Error('Arena retirement refused a redirected or foreign Go cache directory');
      }

      const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        const opened = await directory.stat();
        if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino || opened.uid !== before.uid) {
          throw new Error('Go cache directory changed during arena retirement');
        }

        if ((opened.mode & 0o700) !== 0o700) {
          await directory.chmod((opened.mode & 0o777) | 0o700);
        }

        for (const entry of await readdir(path, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            await writableCacheDirectories(join(path, entry.name));
          }
        }
      } finally {
        await directory.close();
      }
    };

    const cache = join(home, 'go', 'pkg', 'mod');
    let cacheExists = true;
    try {
      await lstat(cache); 
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      cacheExists = false;
    }

    if (cacheExists) {
      await writableCacheDirectories(cache);
    }

    const current = await lstat(arena);
    if (current.dev !== info.dev || current.ino !== info.ino || await realpath(arena) !== arena) {
      throw new Error('Private arena changed before retirement');
    }

    await rm(arena, { recursive: true });
  }
}

export function observationalWorkspace(): Workspace {
  return new Workspace(requireEnvironment('OMNIVIEW_E2E_ROOT'), requireEnvironment('OMNIVIEW_E2E_WORKSPACE'), false, { workspaceID: requireEnvironment('OMNIVIEW_E2E_WORKSPACE_ID'), generation: requireEnvironment('OMNIVIEW_E2E_GENERATION') });
}
