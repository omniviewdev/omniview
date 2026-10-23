import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';

// Read-only attach. It does not launch, terminate, focus, reset settings or close
// sessions. A native source build must already advertise authenticated MCP.
const { values } = parseArgs({ options: Object.fromEntries(['cli', 'root', 'workspace', 'workspace-id', 'generation', 'window', 'output'].map(name => [name, { type: 'string' }])) });
for (const name of ['cli', 'root', 'workspace', 'workspace-id', 'generation', 'window', 'output']) {
  if (!values[name]) throw new Error(`--${name} is required`);
}
if (!isAbsolute(values.cli) || !isAbsolute(values.output)) throw new Error('CLI and output paths must be absolute');
const execute = promisify(execFile);
const env = { ...process.env, GOWORK: 'off' };
for (const key of Object.keys(env)) if (key.startsWith('OMNIVIEW_') || key.startsWith('WAILS_') || key.startsWith('GIT_')) delete env[key];
const selection = ['--root', values.root, '--workspace', values.workspace, '--json'];
async function inspect() {
  let stdout;
  try { ({ stdout } = await execute(values.cli, ['instance', 'inspect', ...selection], { env, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })); }
  catch { throw new Error('Authenticated CLI instance inspection failed; refusing native attachment'); }
  const response = JSON.parse(stdout);
  const descriptor = response.result;
  if (response.status !== 'succeeded' || response.error || descriptor?.schemaVersion !== 1 || descriptor.kind !== 'development' || descriptor.workspaceID !== values['workspace-id'] || descriptor.generation !== values.generation || response.workspaceID !== descriptor.workspaceID || response.generation !== descriptor.generation) throw new Error('Native UUID/generation does not match explicit target');
  return descriptor;
}
const descriptor = await inspect();
if (descriptor.endpoints?.browser || !descriptor.endpoints?.mcp) throw new Error('Native probe requires a native MCP host, not a server-mode synthetic window');
// A16 uses a distinct native MCP token, NOT the discovery control bearer token.
const { stdout } = await execute(values.cli, ['workspace', 'inspect', ...selection], { env, timeout: 30_000 });
const status = JSON.parse(stdout);
if (status.launchPhase !== 'ready' || status.instance?.generation !== descriptor.generation || status.manifest?.workspaceID !== descriptor.workspaceID) throw new Error('Supervisor is not ready for the intended native host');
const tokenFile = join(status.root, '.local', `mcp-${descriptor.generation}.secret`);
const info = await lstat(tokenFile);
if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0) || (process.getuid && info.uid !== process.getuid())) throw new Error('Native MCP token must be an owned private regular file');
const token = await readFile(tokenFile, 'utf8');
if (token.length < 32) throw new Error('Native MCP token is invalid');
const endpoint = new URL(descriptor.endpoints.mcp);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== '/mcp' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Refusing invalid or non-loopback MCP endpoint');
async function rpc(method, params) {
  const id = randomUUID();
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'MCP-Protocol-Version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  if (!response.ok) throw new Error(`Native MCP ${method} failed (${response.status})`);
  const result = await response.json();
  if (result.id !== id || result.error || !result.result || result.result.isError) throw new Error(`Native MCP ${method} failed; no native WebView evidence obtained`);
  return result.result;
}
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'omniview-owned-verification', version: '1' } });
const { tools } = await rpc('tools/list', {});
for (const name of ['windows_list', 'js_eval']) if (!tools?.some(tool => tool.name === name)) throw new Error(`Actual native MCP does not advertise ${name}`);
const windowsResult = await rpc('tools/call', { name: 'windows_list', arguments: {} });
const windows = JSON.parse(windowsResult.content[0].text);
if (!windows.some(window => window.name === values.window)) throw new Error('Explicit native window does not exist; refusing focused/first-window fallback');
const result = await rpc('tools/call', {
  name: 'js_eval',
  arguments: { window: values.window, timeout_ms: 15_000, js: 'return {identity:window.__OMNIVIEW_INSTANCE__ ?? null,title:document.title,url:location.href,shell:!!document.querySelector("[data-testid=app-shell]")};' },
});
const page = JSON.parse(result.content[0].text);
if (page.identity?.schemaVersion !== descriptor.schemaVersion || page.identity?.generation !== descriptor.generation || page.identity?.instanceID !== descriptor.instanceID || page.identity?.kind !== 'development' || page.identity?.displayName !== descriptor.displayName || !page.shell || page.title !== `Omniview — DEV · ${descriptor.displayName}`) throw new Error('Native WebView identity/surface does not match the authenticated target');
await inspect();
await writeFile(values.output, JSON.stringify({ workspaceID: descriptor.workspaceID, instanceID: descriptor.instanceID, generation: descriptor.generation, process: descriptor.process, window: values.window, page, evidence: 'native WebView JavaScript and identity only; no native pixel screenshot, input, binding roundtrip or storage proof' }, null, 2), { mode: 0o600, flag: 'wx' });
console.log(`Native read-only WebView evidence: ${values.output}`);
