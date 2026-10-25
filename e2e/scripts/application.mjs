import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { chmodSync, cpSync, linkSync, mkdirSync, readFileSync, writeFileSync, lstatSync, realpathSync, openSync, closeSync, renameSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, isAbsolute, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { toolEnvironment } from './execution.mjs';
import { cohortEnvironment, prepareApplicationCohort, verifyApplicationCohort } from './cohort.mjs';

// Identical to Playwright 1.64's forceRegExp, including duplicate flag rejection.
export function forceRegExp(pattern) {
  const match = pattern.match(/^\/(.*)\/([gi]*)$/);
  return match ? new RegExp(match[1], match[2]) : new RegExp(pattern, 'gi');
}
export function applicationEnvironment(input, home) {
  return { ...toolEnvironment(input), HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'), KUBECONFIG: join(home, '.kube/config'), GOWORK: 'off' };
}
export function validateApplicationSelection(value) {
  if (!value || !['profile-a', 'profile-b'].includes(value.name) || typeof value.liveFrontend !== 'boolean') throw Error('Invalid application profile selection');
  return { name: value.name, liveFrontend: value.liveFrontend };
}
export function discoveredSpecs(report, directory) {
  if (report.errors?.length || !Array.isArray(report.suites)) throw Error('Playwright discovery failed');
  const testsDirectory = resolve(directory, 'tests');
  const reportRoot = report.config?.rootDir;
  if (typeof reportRoot !== 'string' || !isAbsolute(reportRoot) || reportRoot !== testsDirectory) throw Error('Playwright discovery root is not the canonical test directory');
  const files = new Set();
  const visit = suite => {
    for (const spec of suite.specs ?? []) {
      if (!spec.tests?.length) continue;
      if (typeof spec.file !== 'string' || !spec.file || spec.file.split(/[\\/]/).includes('..')) throw Error('Discovered test is outside the canonical suite');
      const absolute = resolve(reportRoot, spec.file);
      const withinTests = relative(testsDirectory, absolute);
      if (!withinTests || withinTests === '..' || withinTests.startsWith(`..${sep}`) || isAbsolute(withinTests)) throw Error('Discovered test is outside the canonical suite');
      files.add(relative(directory, absolute).split(sep).join('/'));
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  if (!files.size) throw Error('Focused discovery selected no tests');
  return [...files].sort();
}
export function requiresApplication(specs) {
  return !Array.isArray(specs) || specs.length === 0 || specs.some(spec => typeof spec !== 'string' || (spec !== 'tests/integration' && !spec.startsWith('tests/integration/')));
}
export function validateApplicationDescriptor(descriptor, expected) {
  if (descriptor?.schemaVersion !== 1 || descriptor.kind !== 'development' || descriptor.workspaceID !== expected.workspaceID || descriptor.instanceID !== expected.workspaceID || descriptor.generation !== expected.generation || descriptor.stateRoot !== expected.stateRoot || !['backend-ready', 'host-ready'].includes(descriptor.readiness) || descriptor.endpoints?.browser !== expected.browser || descriptor.process?.pid !== expected.pid || descriptor.process.executable !== expected.binary || descriptor.process.startIdentity !== expected.startIdentity || descriptor.process.workspaceID !== expected.workspaceID || descriptor.process.generation !== expected.generation || descriptor.process.role !== 'host') throw Error('Application is not authentically ready');
  return { ...descriptor, plugins: descriptor.plugins ?? [] };
}
export function prepareApplication({ root, privateRoot, sources, refs, env, execute, phase, recordBuildExecution }) {
  const originalSources = { ...sources };
  const cohort = prepareApplicationCohort({ root, privateRoot, sources, refs, env, execute, phase });
  sources = cohort.sources;
  root = sources.omniview;
  const buildEnvironment = cohortEnvironment(cohort, env);
  const build = (command, args, options = {}) => {
    const cwd = options.cwd ?? root;
    return execute(cohort.tool, ['run', cohort.config, cwd, command, ...args], { ...options, cwd, extraEnv: { ...buildEnvironment, ...options.extraEnv } });
  };
  const directory = join(privateRoot, 'application');
  mkdirSync(directory, { mode: 0o700 });
  const binaryDirectory = join(directory, 'bin');
  mkdirSync(binaryDirectory, { mode: 0o700 });
  // Explicit hostmod outputs are capabilities for existing private directories;
  // the authoritative helper intentionally refuses to create or repair them.
  mkdirSync(join(directory, 'hostmod'), { mode: 0o700 });
  const buildReport = join(directory, 'build-execution.json');
  let buildExecution;
  phase('application-build-once', () => {
    let failure;
    try {
      execute(cohort.tool, ['build', cohort.config, directory, buildReport], { cwd: root, extraEnv: buildEnvironment, timeout: 480_000 });
    } catch (error) { failure = error; }
    try {
      buildExecution = privateJSON(buildReport);
      if (buildExecution.schemaVersion !== 1 || !Array.isArray(buildExecution.stages) || !Array.isArray(buildExecution.plugins)) throw Error('Invalid actual producer execution report');
      recordBuildExecution?.(buildExecution);
    } catch (error) {
      if (failure) throw new AggregateError([failure, error], 'Application build failed and its private execution report could not be read');
      throw error;
    }
    if (failure) throw failure;
    if (buildExecution.succeeded !== true) throw Error('Actual application producers did not all complete');
  });
  if (buildExecution.plugins.length !== 2 || new Set(buildExecution.plugins.map(plugin => plugin.id)).size !== 2) throw Error('Actual plugin build records are incomplete');
  const plugins = [];
  for (const id of ['workspace-probe', 'kubernetes']) {
    const built = buildExecution.plugins.find(plugin => plugin.id === id);
    const source = sources[id];
    const artifact = join(directory, id);
    const sdkIdentity = built?.sdkIdentity;
    if (built?.source !== source || built?.artifact !== artifact || sdkIdentity?.Directory !== sources['plugin-sdk'] || sdkIdentity.ReviewedRevision !== refs['plugin-sdk'] || !/^[a-f0-9]{64}$/.test(sdkIdentity.SourceDigest)) throw Error('Actual plugin build evidence differs from the selected cohort');
    // Both owned branches have joined. Only now copy immutable UI assets and
    // metadata into the already-built private binary artifacts.
    phase(`${id}-artifact-finalize`, () => {
      cpSync(join(source, 'ui/dist/assets'), join(artifact, 'assets'), { recursive: true, errorOnExist: true });
      cpSync(join(source, 'plugin.yaml'), join(artifact, 'plugin.yaml'));
    });
    plugins.push({ id, source: originalSources[id], buildSource: source, ref: refs[id], artifact, sdkIdentity });
  }
  const resolutions = phase('actual-selected-package-resolution-proof', () => verifyApplicationCohort(cohort, (command, args, options) => build(command, args, options)));
  const manifest = { schemaVersion: 1, binary: join(binaryDirectory, 'Omniview-server'), root, commit: refs.omniview, directory, plugins, originalSources, buildSources: sources, cohort, resolutions, buildReport };
  const path = join(directory, 'application.json');
  writeFileSync(path, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  return path;
}
export function prepareViteCacheDirectory(home) {
  const path = join(home, 'vite-cache');
  mkdirSync(path, { mode: 0o700, recursive: true });
  validateOwnedDirectory(path);
  return path;
}
function privateJSON(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw Error('Application metadata must be a private regular owned file');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function validateOwnedDirectory(path) {
  const info = lstatSync(path);
  if (!isAbsolute(path) || realpathSync(path) !== path || !info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw Error('Application ownership directory must be canonical, owned and private');
}
async function port() {
  const server = createServer();
  const listening = Promise.withResolvers();
  server.once('error', listening.reject);
  server.listen(0, '127.0.0.1', listening.resolve);
  await listening.promise;
  const result = server.address().port;
  const closed = Promise.withResolvers();
  server.close(closed.resolve);
  await closed.promise;
  return result;
}
function launch(program, args, options) {
  const identityFile = `${options.log}.identity.json`;
  const stoppedFile = `${options.log}.stopped.json`;
  const command = `${options.log}.command.json`;
  writeFileSync(command, JSON.stringify({ directory: options.cwd, program, args, owner: options.owner, identityFile, stoppedFile, outputWorkspace: options.outputWorkspace, profileWorkspace: options.profileWorkspace }), { flag: 'wx', mode: 0o600 });
  const log = openSync(options.log, 'ax', 0o600);
  const child = spawn(options.wrapper, ['--e2e-own-command', command], { cwd: options.cwd, env: options.env, stdio: ['ignore', log, log] });
  closeSync(log);
  const record = { child, exited: false, identityFile, stoppedFile, owner: options.owner, program: realpathSync(program) };
  const completion = Promise.withResolvers();
  record.done = completion.promise;
  child.once('error', completion.reject);
  child.once('close', (code, signal) => { record.exited = true; completion.resolve({ code, signal }); });
  void record.done.catch(() => {}); // Retain startup failure until owned drain observes it.
  return record;
}
function ownedIdentity(record) {
  const identity = privateJSON(record.identityFile);
  const owner = record.owner;
  if (identity.workspaceID !== owner.WorkspaceID || identity.generation !== owner.Generation || identity.role !== owner.Role || identity.source !== owner.Source || identity.executable !== record.program || !identity.startIdentity || !Number.isInteger(identity.pid) || identity.pid < 1 || (record.identity && JSON.stringify(record.identity) !== JSON.stringify(identity))) throw Error('Actual owned child identity changed');
  record.identity = identity;
  return identity;
}
export function validateStoppedProof(proof, identity) {
  if (proof.childrenEmpty !== true || JSON.stringify(proof.process) !== JSON.stringify(identity)) throw Error('Owned command descendant disposal is unproven; retaining private state');
}
async function stop(record, timeoutMs = 20_000) {
  if (!record) return;
  if (!record.exited) record.child.kill('SIGINT');
  const expired = Promise.withResolvers();
  const timer = setTimeout(() => expired.reject(Error('Owned application did not exit; retaining private state')), timeoutMs);
  let outcome;
  try { outcome = await Promise.race([record.done, expired.promise]); }
  finally { clearTimeout(timer); }
  validateStoppedProof(privateJSON(record.stoppedFile), ownedIdentity(record));
  if (outcome.code !== 0 || outcome.signal) throw Error('Owned command failed; private state retained with its stopped proof');
}
export async function startApplicationBroker({ application, ownershipDir, env, phases }) {
  validateOwnedDirectory(ownershipDir);
  const artifact = privateJSON(application);
  if (artifact.schemaVersion !== 1 || !isAbsolute(artifact.binary) || realpathSync(artifact.binary) !== artifact.binary) throw Error('Invalid invocation application artifact');
  const profiles = new Map();
  const records = new Set();
  const handlers = new Set();
  const sockets = new Set();
  const queues = new Map();
  const publishOwnership = (profile, phase, descriptor) => {
    const path = join(ownershipDir, `${profile.name}-application.json`);
    const previous = privateJSON(path);
    if (previous.workspaceID !== profile.descriptor.workspaceID || previous.stateRoot !== profile.descriptor.stateRoot || previous.manifest !== profile.manifest) throw Error('Application ownership journal changed');
    const temporary = `${path}.${randomUUID()}`;
    writeFileSync(temporary, JSON.stringify({ ...previous, phase, generation: profile.generation, supervisorPID: profile.host?.child.pid, pid: descriptor?.process.pid ?? previous.pid, descriptor: descriptor ?? previous.descriptor, childrenEmpty: phase === 'stopped' }), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  };
  let accepting = true;
  let drain;
  const timed = async (name, fn) => { const started = Date.now(); try { return await fn(); } finally { phases.push({ name, elapsedMs: Date.now() - started }); } };
  const control = async (profile, operation, params) => {
    const discovery = privateJSON(join(profile.runtimeRoot, 'discovery.json'));
    if (discovery.workspaceID !== profile.descriptor.workspaceID || discovery.stateRoot !== profile.descriptor.stateRoot || discovery.generation !== profile.generation || JSON.stringify(discovery.process) !== JSON.stringify(ownedIdentity(profile.host))) throw Error('Application discovery ownership mismatch');
    const hash = createHash('sha256').update(`${discovery.workspaceID}\0${discovery.generation}`).digest('hex');
    if (discovery.tokenFile !== join(profile.runtimeRoot, `control-token-${hash}.secret`)) throw Error('Invalid application control token selection');
    const tokenInfo = lstatSync(discovery.tokenFile);
    if (!tokenInfo.isFile() || tokenInfo.isSymbolicLink() || (tokenInfo.mode & 0o077)) throw Error('Application token is not private');
    const endpoint = new URL(discovery.endpoints.control);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== '/v1/control' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('Invalid owned control endpoint');
    const requestID = randomUUID();
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(operation === 'operation.wait' ? 32_000 : 2_000), headers: { Authorization: `Bearer ${readFileSync(discovery.tokenFile, 'utf8')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, requestID, workspaceID: discovery.workspaceID, generation: discovery.generation, operation, params }) });
    const result = await response.json();
    if (!response.ok || result.requestID !== requestID || result.workspaceID !== discovery.workspaceID || result.generation !== discovery.generation) throw Error('Authenticated application control identity mismatch');
    return result;
  };
  const inspect = async profile => {
    const result = await control(profile, 'instance.inspect', {});
    if (result.status !== 'succeeded') throw Error('Application inspection did not succeed');
    // Native window-ready is impossible before the first server browser exists.
    // The actual host observer has independently fetched identity-bearing HTML
    // before advertising this endpoint; controller/bootstrap startup precedes it.
    const process = ownedIdentity(profile.host);
    return validateApplicationDescriptor(result.result, { workspaceID: profile.descriptor.workspaceID, stateRoot: profile.descriptor.stateRoot, generation: profile.generation, pid: process.pid, startIdentity: process.startIdentity, binary: artifact.binary, browser: `http://127.0.0.1:${profile.port}/` });
  };
  const ready = async profile => {
    const deadline = Date.now() + 30_000;
    let cause;
    while (Date.now() < deadline) {
      if (profile.host.exited) throw Error('Actual application exited during readiness');
      try { return await inspect(profile); } catch (error) { cause = error; }
      await delay(100);
    }
    throw Error(`Actual application readiness failed: ${cause?.message}`);
  };
  const start = async profile => {
    profile.generation = randomUUID();
    const childEnv = { ...profile.env, OMNIVIEW_WORKSPACE_FILE: profile.manifest, OMNIVIEW_GENERATION: profile.generation, WAILS_SERVER_HOST: '127.0.0.1', WAILS_SERVER_PORT: String(profile.port), OMNIVIEW_EXPECTED_SDK_REVISION: env.REVIEWED_SDK_REVISION ?? '', ...(profile.liveFrontend ? { FRONTEND_DEVSERVER_URL: profile.viteURL } : {}) };
    profile.host = launch(artifact.binary, [], { wrapper: artifact.binary, profileWorkspace: profile.manifest, owner: { WorkspaceID: profile.descriptor.workspaceID, Generation: profile.generation, Role: 'host', Source: join(ownershipDir, profile.name, 'artifact') }, cwd: artifact.root, env: childEnv, log: join(ownershipDir, `${profile.name}-${profile.generation}.log`) });
    records.add(profile.host);
    publishOwnership(profile, 'starting');
    const descriptor = await ready(profile);
    publishOwnership(profile, 'running', descriptor);
    return descriptor;
  };
  const open = async selection => {
    const { name, liveFrontend } = validateApplicationSelection(selection);
    let profile = profiles.get(name);
    if (!profile) {
      const home = join(ownershipDir, `${name}-home`);
      mkdirSync(home, { mode: 0o700 });
      mkdirSync(join(home, '.kube'), { mode: 0o700 });
      writeFileSync(join(home, '.kube/config'), 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\ncurrent-context: ""\n', { mode: 0o600, flag: 'wx' });
      const childEnv = applicationEnvironment(env, home);
      const root = join(ownershipDir, name);
      const created = JSON.parse(execFileSync(artifact.binary, ['--e2e-create-profile', root, name, artifact.commit], { env: childEnv, encoding: 'utf8', timeout: 10_000 }));
      linkSync(artifact.binary, join(root, 'artifact', 'Omniview-server'));
      mkdirSync(join(created.descriptor.stateRoot, 'plugins'), { mode: 0o700, recursive: true });
      // Distinct regular copies: neither runtime can mutate another profile's
      // installed binaries/assets. The immutable build itself is shared.
      for (const plugin of artifact.plugins) {
        if (name === 'profile-b' && plugin.id !== 'workspace-probe') continue;
        cpSync(plugin.artifact, join(created.descriptor.stateRoot, 'plugins', plugin.id), { recursive: true, errorOnExist: true });
        const installedBinary = join(created.descriptor.stateRoot, 'plugins', plugin.id, 'bin/plugin');
        execFileSync(artifact.binary, ['--e2e-record-plugin', root, plugin.id, installedBinary, plugin.sdkIdentity.Directory, plugin.sdkIdentity.ReviewedRevision, plugin.sdkIdentity.SourceDigest], { env: childEnv, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] });
      }
      profile = { ...created, name, home, env: childEnv, port: await port(), liveFrontend: false };
      profiles.set(name, profile);
      writeFileSync(join(ownershipDir, `${name}-application.json`), JSON.stringify({ schemaVersion: 1, name, manifest: created.manifest, workspaceID: created.descriptor.workspaceID, stateRoot: created.descriptor.stateRoot, runtimeRoot: created.runtimeRoot, application }), { flag: 'wx', mode: 0o600 });
    }
    if (profile.host && profile.liveFrontend === liveFrontend) return inspect(profile);
    if (profile.host) { await stop(profile.host); profile.host = undefined; }
    if (profile.vite) { await stop(profile.vite); profile.vite = undefined; }
    profile.liveFrontend = liveFrontend;
    if (liveFrontend) {
      const vitePort = await port();
      profile.viteURL = `http://127.0.0.1:${vitePort}`;
      const cli = join(artifact.root, 'node_modules/vite/bin/vite.js');
      profile.vite = launch(process.execPath, [cli, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { wrapper: artifact.binary, outputWorkspace: artifact.cohort.paths.root, owner: { WorkspaceID: profile.descriptor.workspaceID, Generation: randomUUID(), Role: 'vite', Source: artifact.root }, cwd: artifact.root, env: { ...profile.env, WAILS_VITE_PORT: String(vitePort), OMNIVIEW_VITE_ALLOWED_ROOTS: JSON.stringify(Object.values(artifact.buildSources)), OMNIVIEW_VITE_CACHE_DIRECTORY: prepareViteCacheDirectory(profile.home) }, log: join(ownershipDir, `${name}-vite-${randomUUID()}.log`) });
      records.add(profile.vite);
      const deadline = Date.now() + 20_000;
      while (true) {
        try { if ((await fetch(profile.viteURL, { signal: AbortSignal.timeout(1_000) })).ok) break; } catch { /* Observable HTTP admission, not a fixed startup sleep. */ }
        if (profile.vite.exited || Date.now() > deadline) throw Error('Owned alternate frontend did not become ready');
        await delay(100);
      }
    }
    return start(profile);
  };
  const dispatch = async request => {
    if (!accepting) throw Error('Application broker is draining');
    if (request.operation === 'open') return timed('profile-launch', () => open(request));
    const { name } = validateApplicationSelection(request);
    const profile = profiles.get(name);
    if (!profile?.host) throw Error('Unopened application profile');
    if (request.operation === 'inspect') return inspect(profile);
    if (request.operation === 'control' && ['settings.get', 'settings.set', 'operation.wait'].includes(request.command)) return control(profile, request.command, request.params);
    if (request.operation === 'restart') return timed('profile-process-replacement', async () => { await stop(profile.host); profile.host = undefined; return start(profile); });
    throw Error('Invalid application broker operation');
  };
  const socketPath = join(ownershipDir, 'application.sock');
  const server = createServer(socket => {
    sockets.add(socket); socket.setEncoding('utf8'); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    let data = ''; let submitted = false;
    socket.on('data', chunk => {
      if (submitted) return;
      data += chunk;
      if (data.length > 4096) { socket.destroy(); return; }
      if (!data.endsWith('\n')) return;
      submitted = true;
      const task = (async () => {
        try {
          const request = JSON.parse(data);
          const { name } = validateApplicationSelection(request);
          if (!accepting) throw Error('Application broker is draining');
          const operation = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(() => dispatch(request));
          queues.set(name, operation);
          const result = await operation;
          if (!socket.destroyed) socket.end(`${JSON.stringify({ ok: true, result })}\n`);
        } catch (error) {
          if (!socket.destroyed) socket.end(`${JSON.stringify({ ok: false, error: error.message })}\n`);
        }
      })();
      handlers.add(task); void task.finally(() => handlers.delete(task));
    });
  });
  const listening = Promise.withResolvers();
  server.once('error', listening.reject);
  server.listen(socketPath, listening.resolve);
  await listening.promise;
  chmodSync(socketPath, 0o600);
  return { socketPath, closeAndDrain() {
    if (drain) return drain;
    accepting = false;
    const closed = Promise.withResolvers();
    server.close(closed.resolve);
    drain = timed('application-process-teardown', async () => {
      await Promise.allSettled([...handlers]);
      const failures = [];
      for (const profile of profiles.values()) {
        const before = failures.length;
        for (const record of [profile.host, profile.vite]) try { await stop(record); } catch (error) { failures.push(error); }
        if (before === failures.length) try { publishOwnership(profile, 'stopped'); } catch (error) { failures.push(error); }
      }
      for (const socket of sockets) socket.destroy();
      await closed.promise;
      if (failures.length) throw new AggregateError(failures, 'Application ownership retained: process drain incomplete');
      return { requests: records.size, drained: [...records].filter(record => record.exited).length, childrenEmpty: true };
    });
    return drain;
  } };
}
