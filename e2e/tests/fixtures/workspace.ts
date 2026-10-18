import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const deadline = 25 * 60_000;
export type Descriptor = {
  schemaVersion: number; workspaceID: string; instanceID: string; generation: string;
  kind: string; displayName: string; stateRoot: string; readiness: string;
  process: { pid: number; startIdentity: string; executable: string; workspaceID: string; generation: string; role: string; source: string };
  endpoints: { browser: string | null; vite: string | null; hmr: string | null; control: string | null; mcp: string | null };
  plugins: { id: string; source: string; generation: string; mode: string; buildStatus: string; viteStatus: string; rpcStatus: string; controllerStatus: string }[];
};
export type Status = {
  manifest: { workspaceID: string; plugins: { id: string; repositoryID: string; mode: string }[] };
  root: string; stateRoot: string; launchPhase: string; generation?: string; instance?: Descriptor;
  builds?: Record<string, { node: string; phase: string }>;
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
  files: { path: string; appliedHash: string; pending?: boolean }[];
};

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see the A17 harness instructions`);
  return value;
}

function environment(): NodeJS.ProcessEnv {
  // An enclosing human workspace must never select our profile or module graph.
  const env: NodeJS.ProcessEnv = { ...process.env, GOWORK: 'off' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('OMNIVIEW_') || key.startsWith('WAILS_') || key.startsWith('GIT_') || ['pnpm_config_workspace_dir', 'npm_config_workspace_dir'].includes(key.toLowerCase()) || ['GOFLAGS', 'GO_MODFILE', 'NODE_PATH', 'FRONTEND_DEVSERVER_URL'].includes(key)) delete env[key];
  }
  const nativePnpm = process.env.OMNIVIEW_E2E_PNPM_EXECUTABLE;
  if (nativePnpm) {
    if (!isAbsolute(nativePnpm)) throw new Error('OMNIVIEW_E2E_PNPM_EXECUTABLE must identify an absolute private native pnpm12 executable');
    env.OMNIVIEW_PNPM_EXECUTABLE = nativePnpm;
  }
  return env;
}

export async function cli<T>(args: string[]): Promise<T> {
  const binary = requireEnvironment('OMNIVIEW_E2E_CLI');
  if (!isAbsolute(binary)) throw new Error('OMNIVIEW_E2E_CLI must be an absolute built executable (not go run)');
  try {
    const { stdout } = await execute(binary, [...args, '--json'], { env: environment(), timeout: deadline, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout) as T;
  } catch (error) {
    // Do not relay arbitrary build/plugin stdout, token-bearing environment or logs.
    const failure = error as { code?: unknown; stdout?: string };
    let code: string | undefined;
    try { code = JSON.parse(failure.stdout ?? '{}').error?.code; } catch { /* report only exit status */ }
    throw new Error(`Owned workspace CLI ${args.slice(0, 2).join(' ')} failed (${code ?? failure.code ?? 'invalid JSON'}); private collection retained for inspect/down`);
  }
}

function loopback(endpoint: string | null, path?: string): string {
  if (!endpoint) throw new Error('Descriptor does not advertise the required endpoint');
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || (path && url.pathname !== path)) throw new Error('Refusing non-loopback or credential-bearing descriptor endpoint');
  return url.href;
}

async function privateFile(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error('Discovery and token must be private regular files');
  if (process.getuid && info.uid !== process.getuid()) throw new Error('Discovery or token belongs to a different user');
  return readFile(path);
}

export class Workspace {
  descriptor!: Descriptor;
  private readonly edits = new Map<string, { before: Buffer | null; mode: number; current: Buffer }>();
  readonly root: string;
  readonly target: string;
  readonly owned: boolean;
  readonly expected?: { workspaceID: string; generation: string };
  constructor(root: string, target: string, owned: boolean, expected?: { workspaceID: string; generation: string }) {
    this.root = root;
    this.target = target;
    this.owned = owned;
    this.expected = expected;
  }
  selection(): string[] { return ['--root', this.root, '--workspace', this.target]; }
  browserURL(): string { return loopback(this.descriptor.endpoints.browser); }
  async status(): Promise<Status> {
    return cli<Status>(['workspace', 'inspect', ...this.selection()]);
  }
  async repository(id: string): Promise<string> {
    this.assertOwned();
    const paths = await cli<{ workspaceID: string; repositories: Record<string, string> }>(['workspace', 'paths', ...this.selection()]);
    const status = await this.status();
    const path = paths.repositories[id];
    if (paths.workspaceID !== status.manifest.workspaceID || (this.descriptor && paths.workspaceID !== this.descriptor.workspaceID) || !path) throw new Error(`Repository ${id} is not selected in this owned workspace`);
    const target = await realpath(this.target);
    const canonical = await realpath(path);
    const inside = relative(target, canonical);
    if (target !== this.target || canonical !== path || !inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('Source mutation must stay inside an authoritative harness-owned feature worktree');
    return canonical;
  }
  private async sourcePath(repository: string, path: string): Promise<string> {
    if (!path || isAbsolute(path) || path.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || /(?:^|\/)(?:node_modules|dist|build|bin|vendor)(?:\/|$)/.test(path)) throw new Error('Acceptance edits must name ordinary source files, not metadata or generated outputs');
    const root = await this.repository(repository);
    const selected = join(root, path);
    if (await realpath(dirname(selected)) !== dirname(selected)) throw new Error('Acceptance source parent is redirected');
    try {
      const info = await lstat(selected);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Acceptance source must be a regular file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return selected;
  }
  async editSource(repository: string, path: string, transform: (source: string) => string): Promise<void> {
    this.assertOwned();
    const status = await this.status();
    if (this.descriptor && status.generation !== this.descriptor.generation) throw new Error('Reselect the new generation explicitly before editing source');
    const selected = await this.sourcePath(repository, path);
    let before: Buffer | null = null;
    let mode = 0o600;
    try { before = await readFile(selected); mode = (await lstat(selected)).mode & 0o777; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const previous = this.edits.get(selected);
    if (previous && (!before || !before.equals(previous.current))) throw new Error('Acceptance source changed outside its owned edit journal');
    const current = Buffer.from(transform(before?.toString() ?? ''));
    // Record intent before writing: a failed write must never permit dirty removal.
    this.edits.set(selected, { before: previous ? previous.before : before, mode: previous?.mode ?? mode, current });
    await writeFile(selected, current, { mode, flag: before ? 'w' : 'wx' });
  }
  async restoreSources(): Promise<void> {
    this.assertOwned();
    const status = await this.status();
    if (status.launchPhase !== 'stopped') throw new Error('Source restoration requires proven owned workspace down');
    for (const [path, edit] of [...this.edits].reverse()) {
      if (await realpath(this.target) !== this.target || await realpath(dirname(path)) !== dirname(path)) throw new Error('Owned source restoration refused a redirected feature worktree');
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || !Buffer.from(await readFile(path)).equals(edit.current)) throw new Error('Owned source restoration refused a foreign edit; private feature worktree retained');
      if (edit.before === null) await unlink(path);
      else { await writeFile(path, edit.before); await chmod(path, edit.mode); }
      this.edits.delete(path);
    }
  }
  async reselect(): Promise<Descriptor> {
    this.assertOwned();
    const previous = this.descriptor;
    if (!previous) return this.verify();
    const status = await this.status();
    if (!status.instance || status.manifest.workspaceID !== previous.workspaceID || status.instance.instanceID !== previous.instanceID) throw new Error('Reselection refused a different owned profile');
    this.descriptor = undefined as unknown as Descriptor;
    try { return await this.verify(); } catch (error) { this.descriptor = previous; throw error; }
  }
  async verify(): Promise<Descriptor> {
    // The CLI performs kernel start-identity/executable ownership checks, validates
    // private discovery and authenticates instance.inspect. No /health adoption.
    const status = await cli<Status>(['workspace', 'inspect', ...this.selection()]);
    const response = await cli<Response<Descriptor>>(['instance', 'inspect', ...this.selection()]);
    const actual = response.result;
    const advertised = status.instance;
    if (response.error || response.status !== 'succeeded' || status.launchPhase !== 'ready' || !advertised || actual.schemaVersion !== 1 || actual.kind !== 'development' || !['ready', 'host-ready'].includes(actual.readiness) || actual.workspaceID !== status.manifest.workspaceID || actual.stateRoot !== status.stateRoot || actual.workspaceID !== response.workspaceID || actual.generation !== response.generation) throw new Error('Workspace is not an authenticated ready development host');
    for (const key of ['workspaceID', 'instanceID', 'generation', 'stateRoot'] as const) if (actual[key] !== advertised[key]) throw new Error(`Descriptor ${key} changed during readiness check`);
    if (JSON.stringify(actual.process) !== JSON.stringify(advertised.process) || JSON.stringify(actual.endpoints) !== JSON.stringify(advertised.endpoints)) throw new Error('Authenticated process/endpoints differ from supervisor readiness');
    if (this.expected && (actual.workspaceID !== this.expected.workspaceID || actual.generation !== this.expected.generation)) throw new Error('Refusing a different observational UUID/generation');
    if (this.descriptor && (actual.workspaceID !== this.descriptor.workspaceID || actual.instanceID !== this.descriptor.instanceID || actual.generation !== this.descriptor.generation)) throw new Error('Instance generation changed; reselect explicitly before any mutation');
    if (this.owned) {
      const root = await realpath(status.root);
      const receipt = JSON.parse((await privateFile(join(root, '.local', 'links.json'))).toString()) as CompositionReceipt;
      const composition = receipt.plan?.composition;
      if (root !== status.root || receipt.schemaVersion !== 2 || receipt.workspaceID !== actual.workspaceID || receipt.root !== root || receipt.phase !== 'linked' || !composition || composition.workspaceID !== actual.workspaceID || composition.root !== root || composition.version !== '12.14.0' || receipt.evidence?.protocol !== 'workspace' || receipt.evidence?.versions?.length !== 1 || receipt.evidence.versions[0] !== '12.14.0' || receipt.evidence.atomicDist !== true || receipt.evidence.peers !== true || receipt.evidence.runtime !== true || !Array.isArray(receipt.files) || receipt.files.some(file => file.pending)) throw new Error('Ready workspace has no complete native12 composition receipt');
      for (const name of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
        const records = receipt.files.filter(file => file.path === name);
        const generated = join(root, name);
        const info = await lstat(generated);
        if (records.length !== 1 || info.isSymbolicLink() || !info.isFile() || createHash('sha256').update(await readFile(generated)).digest('hex') !== records[0]!.appliedHash) throw new Error('Aggregate workspace files differ from the completed native12 transaction');
      }
    }
    loopback(actual.endpoints.control, '/v1/control');
    this.descriptor = actual;
    return actual;
  }
  assertOwned(): void {
    if (!this.owned) throw new Error('Settings resets, terminal cleanup and lifecycle mutation are forbidden on observational attachment');
  }
  async restart(): Promise<Descriptor> {
    this.assertOwned();
    await this.verify();
    await cli(['workspace', 'restart', ...this.selection(), '--timeout', '20m']);
    const previous = this.descriptor;
    this.descriptor = undefined as unknown as Descriptor;
    try {
      const current = await this.verify();
      if (current.workspaceID !== previous.workspaceID || current.instanceID !== previous.instanceID || current.generation === previous.generation) throw new Error('Restart did not preserve profile and rotate generation');
      return current;
    } catch (error) { this.descriptor = previous; throw error; }
  }
  async control(operation: string, params: unknown, target: Partial<{ workspaceID: string; generation: string }> = {}): Promise<Response> {
    this.assertOwned();
    const descriptor = await this.verify();
    // Custom persistent state roots do not relocate the UUID-owned transient
    // runtime. Ask the actual workspace resolver; never inspect an adjacent tree.
    const paths = await cli<{ workspaceID: string; stateRoot: string; runtimeRoot: string }>(['workspace', 'paths', ...this.selection()]);
    if (paths.workspaceID !== descriptor.workspaceID || paths.stateRoot !== descriptor.stateRoot || typeof paths.runtimeRoot !== 'string' || !isAbsolute(paths.runtimeRoot)) throw new Error('Authoritative runtime paths do not match the selected profile');
    const runtime = await realpath(paths.runtimeRoot);
    const directory = await lstat(runtime);
    if (runtime !== paths.runtimeRoot || !directory.isDirectory() || (process.platform !== 'win32' && (directory.mode & 0o077) !== 0) || (process.getuid && directory.uid !== process.getuid())) throw new Error('Authoritative runtime root must be a canonical owned private directory');
    const discovery = JSON.parse((await privateFile(join(runtime, 'discovery.json'))).toString()) as Descriptor & { tokenFile: string };
    const hash = createHash('sha256').update(`${descriptor.workspaceID}\0${descriptor.generation}`).digest('hex');
    if (discovery.workspaceID !== descriptor.workspaceID || discovery.instanceID !== descriptor.instanceID || discovery.generation !== descriptor.generation || discovery.stateRoot !== descriptor.stateRoot || JSON.stringify(discovery.process) !== JSON.stringify(descriptor.process) || JSON.stringify(discovery.endpoints) !== JSON.stringify(descriptor.endpoints) || discovery.tokenFile !== join(runtime, `control-token-${hash}.secret`)) throw new Error('Private discovery changed before control call');
    const token = await privateFile(discovery.tokenFile);
    if (token.length < 32) throw new Error('Invalid control token');
    const requestID = randomUUID();
    // Node fetch deliberately stays outside Playwright tracing/HAR. Never attach
    // Authorization, token files, request headers or raw private discovery.
    const response = await fetch(loopback(descriptor.endpoints.control, '/v1/control'), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
      headers: { Authorization: `Bearer ${token.toString()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, requestID, workspaceID: target.workspaceID ?? descriptor.workspaceID, generation: target.generation ?? descriptor.generation, operation, params }),
    });
    const result = await response.json() as Response;
    if (result.protocolVersion !== 1 || result.workspaceID !== descriptor.workspaceID || result.generation !== descriptor.generation || (result.requestID && result.requestID !== requestID)) throw new Error('Control response identity mismatch');
    return result;
  }
}

export class OwnedProfiles {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly modes = new Map<string, string>();
  readonly root: string;
  private readonly sources: Sources;
  private constructor(root: string, sources: Sources) {
    this.root = root;
    this.sources = sources;
  }
  static async create(): Promise<OwnedProfiles> {
    const sources = JSON.parse(await readFile(requireEnvironment('OMNIVIEW_E2E_SOURCES'), 'utf8')) as Sources;
    if (!sources.sources?.omniview || !sources.sources?.['plugin-sdk'] || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sources.reviewedSDKRevision) || !isAbsolute(sources.linkEvidence) || !Array.isArray(sources.repositories)) throw new Error('Explicit host/SDK sources, repositories, full reviewed SDK revision and absolute link evidence are required');
    for (const [id, path] of Object.entries(sources.sources)) if (!isAbsolute(path) || !sources.refs?.[id]) throw new Error(`Explicit absolute source and committed ref required for ${id}`);
    const evidence = JSON.parse(await readFile(sources.linkEvidence, 'utf8')) as LinkEvidence;
    if (evidence.protocol !== 'workspace' || !Array.isArray(evidence.versions) || evidence.versions.length !== 1 || evidence.versions[0] !== '12.14.0' || evidence.atomicDist !== true || evidence.peers !== true || evidence.runtime !== true) throw new Error('The actual native12 feature-workspace live-output and recursive-peer protocol evidence is required; independent-root evidence is not accepted');
    const root = await realpath(await mkdtemp(join(tmpdir(), 'omniview-e2e-')));
    const profiles = new OwnedProfiles(root, sources);
    await cli(['workspace', 'init', '--root', root, ...Object.entries(sources.sources).flatMap(([id, path]) => ['--source', `${id}=${path}`, '--source-ref', `${id}=${sources.refs[id]}`])]);
    return profiles;
  }
  async get(name: string, options: ProfileOptions = {}): Promise<Workspace> {
    const mode = JSON.stringify({ liveFrontend: options.liveFrontend ?? this.sources.liveFrontend === true, watch: options.watch ?? false });
    const existing = this.workspaces.get(name);
    if (existing) {
      if (this.modes.get(name) !== mode || options.prepare) throw new Error('Owned profile options cannot change after creation');
      await existing.verify(); return existing;
    }
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) throw new Error('Invalid disposable profile name');
    const created = await cli<{ root: string }>(['workspace', 'create', name, '--root', this.root, '--name', `E2E ${name}`, '--state-root', join(this.root, 'profiles', name, 'state'), ...this.sources.repositories.flatMap(id => ['--repo', id]), ...(this.sources.plugins ?? []).flatMap(id => ['--plugin', id])]);
    const workspace = new Workspace(this.root, created.root, true);
    // Register before startup so a timed-out launch still goes through owned down.
    this.workspaces.set(name, workspace);
    this.modes.set(name, mode);
    // Kubernetes's standalone default scans the human kubeconfig. The disposable
    // selected source instead exposes zero connections before any process starts.
    for (const plugin of (await workspace.status()).manifest.plugins) {
      if (plugin.id !== 'kubernetes') continue;
      await workspace.editSource(plugin.repositoryID, 'pkg/main.go', source => {
        const original = 'Default:     []string{"~/.kube/config"}';
        if (source.split(original).length !== 2) throw new Error('Kubernetes safe startup prerequisite changed: cannot disable human kubeconfig discovery');
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
    const stopped: [string, Workspace][] = [];
    for (const [name, workspace] of [...this.workspaces].reverse()) {
      try { await cli(['workspace', 'down', ...workspace.selection(), '--timeout', '2m']); stopped.push([name, workspace]); }
      catch { failures.push(name); }
    }
    for (const [name, workspace] of stopped) {
      try {
        await workspace.restoreSources();
        await cli(['workspace', 'unlink', ...workspace.selection()]);
        await cli(['workspace', 'remove', ...workspace.selection(), '--delete-state', '--delete-branches']);
      } catch { failures.push(name); }
    }
    // Never kill by port/PID, recursively remove worktrees, or bypass dirty refusal.
    if (failures.length) throw new Error(`Owned cleanup refused for ${failures.join(', ')}; retained private collection ${this.root}; use workspace inspect/down/remove explicitly`);
  }
}

export function observationalWorkspace(): Workspace {
  return new Workspace(requireEnvironment('OMNIVIEW_E2E_ROOT'), requireEnvironment('OMNIVIEW_E2E_WORKSPACE'), false, { workspaceID: requireEnvironment('OMNIVIEW_E2E_WORKSPACE_ID'), generation: requireEnvironment('OMNIVIEW_E2E_GENERATION') });
}
