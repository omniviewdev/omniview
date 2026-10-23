import { execFileSync } from 'node:child_process';
import { closeSync, constants, copyFileSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalidXMLCharacter = /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u;
const escapeXML = (value) => {
  if (invalidXMLCharacter.test(value)) {
    throw new Error('Development bundle values must contain only XML 1.0 characters');
  }
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
};

export function renderDevPlist(template, manifest, executable) {
  if (manifest.profile?.kind !== 'development' || !uuid.test(manifest.workspaceID)
    || manifest.workspaceID === '00000000-0000-0000-0000-000000000000') {
    throw new Error('A canonical development workspace UUID is required');
  }
  if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim()
    || /[\x00\r\n]/.test(manifest.displayName)) {
    throw new Error('A nonempty single-line workspace displayName is required');
  }
  if (!executable || path.basename(executable) !== executable) {
    throw new Error('Executable must be a filename');
  }
  const values = {
    __OMNIVIEW_EXECUTABLE__: executable,
    __OMNIVIEW_BUNDLE_ID__: `dev.omniview.workspace.${manifest.workspaceID}`,
    __OMNIVIEW_DISPLAY_NAME__: `Omniview — ${manifest.displayName}`,
  };
  return template.replace(/__OMNIVIEW_[A-Z_]+__/g, (token) => {
    if (!(token in values)) throw new Error(`Unknown dev plist token: ${token}`);
    return escapeXML(values[token]);
  });
}

const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function requirePrivate(info, directory, description) {
  if (typeof process.geteuid !== 'function' || info.uid !== BigInt(process.geteuid())
    || (info.mode & 0o077n) !== 0n || !(directory ? info.isDirectory() : info.isFile())) {
    throw new Error(`${description} must be a private, current-user-owned ${directory ? 'directory' : 'regular file'}`);
  }
}

function requirePrivateDirectory(directory) {
  requirePrivate(lstatSync(directory, { bigint: true }), true, directory);
  if (realpathSync(directory) !== directory) throw new Error('Native bundle capability directory is redirected');
}

function readPrivateLedger(filename) {
  const before = lstatSync(filename, { bigint: true });
  requirePrivate(before, false, filename);
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd, { bigint: true });
    requirePrivate(opened, false, filename);
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('Native bundle capability ledger changed while opening');
    }
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally {
    closeSync(fd);
  }
}

export function validateDevBundleDirectory(binArg, resolved, hostArg, generation) {
  const bin = realpathSync(binArg);
  const lexicalBin = path.resolve(binArg);
  const host = realpathSync(hostArg);
  const root = resolved.root;
  const local = path.join(root, '.local');
  const stageNamedInput = path.dirname(lexicalBin) === local
    && path.basename(lexicalBin).startsWith('.generated-stage-');
  // A redirected staging pathname must not fall back to an ordinary allowed root.
  if (!stageNamedInput && (within(host, bin) || within(path.dirname(resolved.stateRoot), bin))) return bin;

  const workspaceID = resolved.manifest.workspaceID;
  if (!uuid.test(workspaceID) || workspaceID === '00000000-0000-0000-0000-000000000000'
    || resolved.manifest.profile?.kind !== 'development' || !generation
    || !path.isAbsolute(root) || realpathSync(root) !== root) {
    throw new Error('Native staging requires an exact active development workspace capability');
  }
  const collection = path.dirname(path.dirname(root));
  if (path.dirname(root) !== path.join(collection, 'workspaces')) {
    throw new Error('Native staging requires a registered workspace collection');
  }
  const metadata = path.join(collection, '.omniview-dev');
  const records = path.join(metadata, 'generated');
  for (const directory of [local, metadata, records]) requirePrivateDirectory(directory);
  const ledger = readPrivateLedger(path.join(records, `${workspaceID}.json`));
  const pending = isRecord(ledger.pending) ? ledger.pending['bin/native'] : null;
  if (ledger.schemaVersion !== 1 || ledger.workspaceID !== workspaceID || ledger.root !== root
    || !isRecord(ledger.entries) || !isRecord(pending) || pending.phase !== 'prepared'
    || pending.generation !== generation || !uuid.test(pending.nonce)
    || pending.nonce === '00000000-0000-0000-0000-000000000000'
    || pending.stage !== `.generated-stage-${pending.nonce}`) {
    throw new Error('Native bundle staging capability is missing, foreign or stale');
  }
  const expectedStage = path.join(local, pending.stage);
  const identity = pending.stageIdentity;
  if (lexicalBin !== expectedStage || bin !== expectedStage || !isRecord(identity)
    || typeof identity.device !== 'string' || typeof identity.fileID !== 'string'
    || !/^(0|[1-9][0-9]*)$/.test(identity.device) || !/^(0|[1-9][0-9]*)$/.test(identity.fileID)) {
    throw new Error('Native bundle staging path or directory identity is invalid');
  }
  const before = lstatSync(bin, { bigint: true });
  requirePrivate(before, true, bin);
  const fd = openSync(bin, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd, { bigint: true });
    requirePrivate(opened, true, bin);
    if (opened.dev !== before.dev || opened.ino !== before.ino
      || String(opened.dev) !== identity.device || String(opened.ino) !== identity.fileID) {
      throw new Error('Native bundle staging directory was replaced');
    }
  } finally {
    closeSync(fd);
  }
  return bin;
}

function main() {
  const [binArg, executable, cliArg] = process.argv.slice(2);
  if (!binArg || !executable || !cliArg) throw new Error('Expected BIN_DIR APP_NAME DEV_CLI');
  if (!process.env.OMNIVIEW_WORKSPACE_FILE || !process.env.OMNIVIEW_STATE_DIR) {
    throw new Error('Select OMNIVIEW_WORKSPACE_FILE and OMNIVIEW_STATE_DIR before launching development');
  }
  const major = Number(execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).split('.')[0]);
  if (major < 14) throw new Error('Named native development requires macOS 14+; use browser/server mode on older macOS');
  // Reuse the authoritative resolver for target conflicts, symlinks and state ownership.
  const resolved = JSON.parse(execFileSync(path.resolve(cliArg), ['workspace', 'inspect', '--json'], { encoding: 'utf8' }));
  const bin = validateDevBundleDirectory(binArg, resolved, '.', process.env.OMNIVIEW_GENERATION);
  createDevBundle(bin, executable, resolved.manifest);
}

export function createDevBundle(bin, executable, manifest) {
  const template = readFileSync(new URL('./Info.dev.plist', import.meta.url), 'utf8');
  // Render and validate every XML value before creating or replacing any output.
  const plist = renderDevPlist(template, manifest, executable);
  const bundle = path.join(bin, `${executable}.dev.app`);
  mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(path.join(bundle, 'Contents', 'Resources'), { recursive: true });
  copyFileSync(path.join(bin, executable), path.join(bundle, 'Contents', 'MacOS', executable));
  copyFileSync(new URL('./icons.icns', import.meta.url), path.join(bundle, 'Contents', 'Resources', 'icons.icns'));
  writeFileSync(path.join(bundle, 'Contents', 'Info.plist'), plist);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
