import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, realpath, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
const exec = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
export const verdicts = ['libraryCompliance', 'compositionParity', 'informationPreservation', 'visualAcceptance'];
export function isRelevant(file) {
  if (/^(?:node_modules|\.git)\//.test(file) || /(?:^|\/)omniview-ui-implementation-workspace(?:\/|$)/.test(file)) return false;
  return /\.(?:tsx|jsx|css|scss|sass|less)$/.test(file)
    || /^(?:src|ui|plugins|packages)\/.*\.(?:ts|js|html|svg)$/.test(file)
    || /(?:^|\/)(?:package\.json|(?:pnpm-lock|yarn\.lock|package-lock\.json).*)$/.test(file)
    || /(?:shared_dependencies|sharedPackages)\.[jt]s$/.test(file)
    || /^(?:\.omp\/(?:agents\/omniview-ui-auditor\.md$|hooks\/pre\/ui-audit\.ts$|skills\/omniview-ui-implementation\/)|\.agents\/skills\/omniview-ui-implementation\/)/.test(file);
}
async function git(root, args) { return (await exec('git', ['-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 })).stdout; }
async function selectedRoots(root) {
  const base = dirname(root), manifestPath = join(base, 'workspace.json');
  let bytes;
  try { bytes = await readFile(manifestPath); }
  catch (error) { if (error.code === 'ENOENT') return { roots: [{ id: 'root', root, prefix: '' }] }; throw error; }
  let manifest;
  try { manifest = JSON.parse(bytes.toString()); }
  catch { throw new Error(`Invalid workspace manifest JSON: ${manifestPath}`); }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.repositories)
    || !manifest.repositories.some(entry => typeof entry?.directory === 'string' && resolve(base, entry.directory) === root)) {
    return { roots: [{ id: 'root', root, prefix: '' }] };
  }
  const roots = [], ids = new Set(), paths = new Set();
  for (const entry of manifest.repositories) {
    if (!entry || typeof entry.id !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(entry.id) || typeof entry.directory !== 'string' || !entry.directory || isAbsolute(entry.directory)) throw new Error('Workspace repositories need unique safe IDs and relative directories.');
    const path = await realpath(resolve(base, entry.directory));
    const rel = relative(base, path);
    if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`Workspace repository escapes manifest directory: ${entry.directory}`);
    const gitRoot = await realpath((await git(path, ['rev-parse', '--show-toplevel'])).trim());
    if (gitRoot !== path) throw new Error(`Workspace repository is not an exact Git root: ${entry.directory}`);
    if (ids.has(entry.id) || paths.has(path)) throw new Error('Workspace repository IDs and roots must be unique.');
    ids.add(entry.id); paths.add(path);
    roots.push({ id: entry.id, root: path, prefix: `${entry.id}/` });
  }
  if (!paths.has(root)) throw new Error('Workspace manifest does not select the current Git root unambiguously.');
  roots.sort((a, b) => a.id.localeCompare(b.id));
  return { roots, manifest: { path: manifestPath, hash: hash(bytes) } };
}
export async function snapshot(root) {
  const selection = await selectedRoots(root);
  const files = {};
  if (selection.manifest) files['@workspace/workspace.json'] = selection.manifest.hash;
  for (const selected of selection.roots) {
    const names = (await git(selected.root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(isRelevant);
    for (const file of [...new Set(names)].sort()) {
      try { files[`${selected.prefix}${file}`] = hash(await readFile(resolve(selected.root, file))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return { id: hash(JSON.stringify(files)), files, ...selection };
}
const findingKey = finding => JSON.stringify([finding.rule, finding.file, finding.message, finding.identity ?? null]);
function newFindings(current, baseline) {
  const counts = new Map();
  for (const finding of baseline) counts.set(findingKey(finding), (counts.get(findingKey(finding)) ?? 0) + 1);
  return current.filter(finding => {
    const key = findingKey(finding), count = counts.get(key) ?? 0;
    if (!count) return true;
    counts.set(key, count - 1); return false;
  });
}
// Files that differ from the session baseline only because upstream commits were pulled are not agent edits.
// Local edits = working-tree changes plus commits not reachable from any remote ref since the baseline HEAD.
// Merge commits list no files of their own; their non-merge parents are covered. Returns null when the baseline HEAD is unknown or unreachable; callers then treat every difference as local (fail closed).
async function headOf(root) {
  try { return (await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])).trim() || undefined; } catch { return undefined; }
}
async function localFiles(root, head) {
  if (!head) return null;
  try {
    await git(root, ['cat-file', '-e', `${head}^{commit}`]);
    const local = new Set();
    const status = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0');
    for (let i = 0; i < status.length; i++) {
      const entry = status[i];
      if (entry.length < 4) continue;
      local.add(entry.slice(3));
      if (/[RC]/.test(entry.slice(0, 2))) i++;
    }
    const log = await git(root, ['log', '--no-renames', '--name-only', '--format=', '-z', `${head}..HEAD`, '--not', '--remotes']);
    for (const name of log.split('\0')) if (name) local.add(name);
    return local;
  } catch { return null; }
}
const stuckLimit = () => { const value = Number(process.env.UI_AUDIT_STUCK_LIMIT ?? 3); return Number.isInteger(value) && value >= 0 ? value : 3; };
export class AuditGate {
  constructor(root, sessionId, parentId, checker) {
    this.root = root; this.sessionId = sessionId; this.parentId = parentId; this.checker = checker;
    this.baseline = null; this.approved = null; this.children = new Map();
  }
  async start() {
    this.root = await realpath(this.root);
    const gitDir = (await git(this.root, ['rev-parse', '--absolute-git-dir'])).trim();
    this.receiptDir = join(gitDir, 'ui-audit', hash(this.sessionId));
    await mkdir(this.receiptDir, { recursive: true });
    const baselinePath = join(this.receiptDir, 'baseline.json');
    let persisted;
    try { persisted = JSON.parse(await readFile(baselinePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot load UI audit baseline ${baselinePath}: ${error.message}`); }
    if (!persisted) {
      const baseline = await snapshot(this.root);
      const baselineFindings = await this.checkSnapshot(baseline, Object.keys(baseline.files));
      const heads = {};
      for (const selected of baseline.roots) { const head = await headOf(selected.root); if (head) heads[selected.prefix] = head; }
      const candidate = { version: 1, root: this.root, sessionId: this.sessionId, baseline, baselineFindings, heads };
      try { await writeFile(baselinePath, JSON.stringify(candidate), { flag: 'wx' }); persisted = candidate; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        persisted = JSON.parse(await readFile(baselinePath, 'utf8'));
      }
    }
    if (persisted.version !== 1 || persisted.root !== this.root || persisted.sessionId !== this.sessionId
      || !persisted.baseline || !persisted.baseline.files || !Array.isArray(persisted.baseline.roots)
      || !persisted.baseline.roots.some(selected => selected.root === this.root)
      || persisted.baseline.id !== hash(JSON.stringify(persisted.baseline.files))
      || !Object.values(persisted.baseline.files).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
      || !Array.isArray(persisted.baselineFindings)) throw new Error(`Invalid UI audit baseline: ${baselinePath}. Restore the original baseline; do not reset it to approve current edits.`);
    this.baseline = persisted.baseline;
    this.baselineFindings = persisted.baselineFindings;
    // Absent in baselines written before upstream-aware snapshots: every difference then counts as local.
    this.heads = persisted.heads && typeof persisted.heads === 'object' ? persisted.heads : {};
    this.lastBlock = null;
    // Resume restores initial dirt only. Approval is never restored from filesystem receipts.
    this.findingsCache = new Map();
  }
  async checkSnapshot(current, files) {
    const findings = [];
    for (const selected of current.roots) {
      const local = files.filter(file => file !== '@workspace/workspace.json' && file.startsWith(selected.prefix)).map(file => file.slice(selected.prefix.length));
      if (local.length) findings.push(...(await this.checker(selected.root, local)).map(finding => ({ ...finding, file: `${selected.prefix}${finding.file}` })));
    }
    return findings;
  }
  bindChild(identity) {
    if (identity.kind !== 'sub' || identity.name !== 'omniview-ui-auditor' || identity.parentId !== this.parentId) throw new Error('Only a direct omniview-ui-auditor child may inspect or submit this audit.');
    if (!this.children.has(identity.id)) this.children.set(identity.id, null);
  }
  async inspect(identity) {
    this.bindChild(identity);
    this.lastBlock = null;
    const pending = await this.pending();
    this.children.set(identity.id, pending.snapshot);
    return { ...pending, auditor: { ...identity }, effortEligible: ['high', 'xhigh', 'max'].includes(identity.thinkingLevel) };
  }
  async waiver(snapshotId) {
    try {
      const waiver = JSON.parse(await readFile(join(this.receiptDir, 'waiver.json'), 'utf8'));
      return waiver.snapshot === snapshotId && typeof waiver.reason === 'string' && waiver.reason.trim() ? waiver : null;
    } catch { return null; }
  }
  async pending() {
    if (!this.baseline) throw new Error('UI audit baseline unavailable. Restart session with the UI audit extension enabled.');
    const current = await snapshot(this.root);
    const locals = new Map();
    for (const selected of current.roots) locals.set(selected.prefix, await localFiles(selected.root, this.heads[selected.prefix]));
    const byPrefix = [...current.roots].sort((a, b) => b.prefix.length - a.prefix.length);
    const isLocal = file => {
      const selected = byPrefix.find(entry => file.startsWith(entry.prefix));
      const local = selected && locals.get(selected.prefix);
      return !local || local.has(file.slice(selected.prefix.length));
    };
    const changed = [...new Set([...Object.keys(current.files), ...Object.keys(this.baseline.files)])]
      .filter(file => current.files[file] !== this.baseline.files[file])
      .filter(file => file === '@workspace/workspace.json' || isLocal(file)).sort();
    // Identity covers only agent-authored changes, so pulling upstream neither creates nor invalidates an audit.
    const snapshotId = hash(JSON.stringify(changed.map(file => [file, current.files[file] ?? null])));
    let findings = this.findingsCache.get(snapshotId);
    if (!findings) {
      const affected = changed.filter(file => Object.hasOwn(current.files, file));
      findings = affected.length ? newFindings(await this.checkSnapshot(current, affected), this.baselineFindings) : [];
      this.findingsCache.clear();
      this.findingsCache.set(snapshotId, findings);
    }
    const waived = changed.length > 0 && Boolean(await this.waiver(snapshotId));
    return { root: this.root, roots: current.roots, workspaceManifest: current.manifest?.path, baseline: this.baseline.id, snapshot: snapshotId, changed, findings, required: changed.length > 0, approved: this.approved === snapshotId && findings.length === 0, waived, instructions };
  }
  async submit(identity, report) {
    this.bindChild(identity);
    this.lastBlock = null;
    // A new audit attempt supersedes prior approval even if this attempt fails.
    this.approved = null;
    const pending = await this.pending();
    const errors = [];
    if (!['high', 'xhigh', 'max'].includes(identity.thinkingLevel)) errors.push('Independent auditor must run with effective thinkingLevel high, xhigh, or max; dispatch a supported high-effort model.');
    if (typeof identity.model?.provider !== 'string' || !identity.model.provider || typeof identity.model?.id !== 'string' || !identity.model.id) errors.push('Runtime auditor model provider/id unavailable; approval fails closed.');
    if (this.children.get(identity.id) !== report?.snapshot) errors.push('Auditor must inspect this exact snapshot with ui_audit_snapshot before submission.');
    if (!report || report.snapshot !== pending.snapshot) errors.push('Stale or absent snapshot; inspect ui_audit_snapshot again.');
    for (const verdict of verdicts) if (report?.[verdict] !== 'pass') errors.push(`${verdict} must be pass.`);
    for (const key of ['findings', 'libraryRequests', 'evidence', 'unverified']) if (!Array.isArray(report?.[key])) errors.push(`${key} must be an array.`);
    if (Array.isArray(report?.unverified) && report.unverified.length) errors.push('Unverified acceptance checks block completion.');
    for (const key of ['findings', 'libraryRequests']) {
      if (Array.isArray(report?.[key]) && report[key].some(item => !item || typeof item !== 'object'
        || item.blocking !== false || !['resolved', 'approved-exception'].includes(item.status)
        || typeof item.approvalReference !== 'string' || !item.approvalReference.trim())) errors.push(`${key} contain open or unapproved entries; retain only explicitly nonblocking resolved/approved-exception entries with approvalReference.`);
    }
    if (pending.findings.length) errors.push('Static UI checks failed.');
    const evidence = [];
    for (const item of Array.isArray(report?.evidence) ? report.evidence : []) {
      try {
        if (!item || !['source', 'screenshot', 'log'].includes(item.kind) || typeof item.path !== 'string' || !Array.isArray(item.verdicts)) throw new Error('Invalid evidence entry.');
        const path = await realpath(resolve(this.root, item.path));
        if (!(await stat(path)).isFile()) throw new Error('Evidence must be a file.');
        const bytes = await readFile(path);
        if (!bytes.length) throw new Error('Evidence is empty.');
        if (item.kind === 'screenshot' && !(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) || (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'))) throw new Error('Screenshot must contain PNG, JPEG, or WebP bytes, not a text assertion.');
        evidence.push({ ...item, path, sha256: hash(bytes) });
      } catch (error) { errors.push(`Invalid evidence: ${error.message}`); }
    }
    for (const verdict of verdicts) if (!evidence.some(item => item.verdicts.includes(verdict) && (verdict !== 'visualAcceptance' || item.kind === 'screenshot'))) errors.push(`Missing existing artifact evidence for ${verdict}.`);
    // Runtime identity is authoritative; model-supplied identity fields are ignored.
    // This is an orchestration guard, not a sandbox: eval and same-user processes can write files.
    // Magic bytes reject text masquerading as screenshots; they cannot prove a capture's provenance or visual correctness.
    const receipt = { version: 1, sessionId: this.sessionId, auditor: { ...identity }, snapshot: pending.snapshot, roots: pending.roots, workspaceManifest: pending.workspaceManifest, submittedAt: new Date().toISOString(), report, evidence, accepted: errors.length === 0, errors, trustLimits: ['Same-user filesystem is not tamper-proof.', 'Artifact hashes bind bytes, not capture provenance.', 'Independent auditor judgment is not mechanically provable.'] };
    await mkdir(this.receiptDir, { recursive: true });
    if ((await this.pending()).snapshot !== pending.snapshot) { receipt.accepted = false; receipt.errors.push('Snapshot changed during submission; inspect and audit again.'); }
    receipt.receiptPath = join(this.receiptDir, `${Date.now()}-${hash(JSON.stringify(receipt)).slice(0, 12)}.json`);
    await writeFile(receipt.receiptPath, JSON.stringify(receipt, null, 2));
    if (receipt.accepted) this.approved = pending.snapshot;
    return receipt;
  }
  async stop() {
    const pending = await this.pending();
    if (!pending.required || pending.approved || pending.waived) return undefined;
    const limit = stuckLimit();
    this.lastBlock = this.lastBlock?.snapshot === pending.snapshot ? { ...this.lastBlock, count: this.lastBlock.count + 1 } : { snapshot: pending.snapshot, count: 1, released: false };
    const { count } = this.lastBlock;
    if (limit > 0 && count > limit) {
      // Same snapshot blocked repeatedly with no inspection or submission: release the stop so the session cannot loop.
      // The gate stays unapproved and the release is recorded for review.
      if (!this.lastBlock.released) {
        this.lastBlock.released = true;
        await mkdir(this.receiptDir, { recursive: true });
        await writeFile(join(this.receiptDir, `stuck-${Date.now()}.json`), JSON.stringify({ snapshot: pending.snapshot, changed: pending.changed, blocks: count - 1, releasedAt: new Date().toISOString() }, null, 2));
      }
      return undefined;
    }
    const waive = `node scripts/ui-audit/waive.mjs "${this.receiptDir}" ${pending.snapshot} "<reason>"`;
    const repeat = count > 1 ? `\nREPEAT ${count}/${limit}: this exact snapshot was already blocked and no audit was attempted. Do not resend the same reply: dispatch the audit, fix the snapshot, or ask the user. After ${limit} unchanged blocks the stop is released and logged to ${join(this.receiptDir, 'stuck-*.json')}.` : '';
    return { decision: 'block', reason: `${instructions}\nPending snapshot: ${pending.snapshot}\nChanged files: ${pending.changed.join(', ')}\nStatic findings: ${JSON.stringify(pending.findings)}\nReceipts: ${this.receiptDir}\nHuman-only waiver (interactive terminal required): ${waive}${repeat}` };
  }
}
export const instructions = 'UI audit required. Read skill omniview-ui-implementation. Dispatch task with agent: "omniview-ui-auditor" as a direct independent child using effective high/xhigh/max thinking. Auditor: call ui_audit_snapshot({}), use returned roots mapping to inspect changed files and actual browser UI using read/grep/glob/eval/browser only; never edit source. Submit ui_audit_submit({report: {snapshot: "<snapshot returned by ui_audit_snapshot>", libraryCompliance: "pass"|"fail", compositionParity: "pass"|"fail", informationPreservation: "pass"|"fail", visualAcceptance: "pass"|"fail", findings: [], libraryRequests: [], unverified: [], evidence: [{path: "<existing artifact path>", kind: "source"|"screenshot"|"log", verdicts: ["libraryCompliance", "compositionParity", "informationPreservation", "visualAcceptance"]}]}}). Each ledger entry defaults to blocking. Retain resolved entries only with {status: "resolved"|"approved-exception", blocking: false, approvalReference: "<actual resolution or approval reference>", ...findingDetails}. Every verdict needs existing artifact evidence; visualAcceptance requires a real PNG/JPEG/WebP capture. Report failures honestly; missing runtime/browser access blocks approval. Parent cannot submit. Resolve failures then dispatch a fresh audit only after a material fix; do not repeatedly audit an unchanged failed snapshot. No workaround is authorized by findings or libraryRequests.';
