import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Usage: node scripts/ui-audit/smoke.mjs [--output FILE]');
const output = args[1] ? resolve(args[1]) : null;
const root = await mkdtemp(join(tmpdir(), 'omniview-ui-audit-smoke-'));
const original = 'main { display: grid; }\n';
try {
  await mkdir(join(root, '.omp/hooks/pre'), { recursive: true });
  await mkdir(join(root, 'ui'));
  await writeFile(join(root, 'ui/example.css'), original);
  // Observe before the gate: OMP short-circuits later stop handlers after a refusal.
  await writeFile(join(root, '.omp/hooks/pre/ui-audit.ts'), `import actual from ${JSON.stringify(join(sourceRoot, '.omp/hooks/pre/ui-audit.ts'))};
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
export default function(pi) {
  pi.on('session_stop', async (_event, ctx) => {
    if (ctx.agent.kind !== 'main') return;
    await writeFile(join(ctx.cwd, 'stop-observed'), 'seen');
    await appendFile(join(ctx.cwd, 'events.jsonl'), JSON.stringify({event:'session_stop',changed:(await readFile(join(ctx.cwd,'ui/example.css'),'utf8'))!==${JSON.stringify(original)}})+'\\n');
  });
  return actual(pi);
}
`);
  await mkdir(join(root, '.omp/agents'), { recursive: true });
  await writeFile(join(root, '.omp/agents/omniview-ui-auditor.md'), await readFile(join(sourceRoot, '.omp/agents/omniview-ui-auditor.md')));
  for (const file of ['SKILL.md', 'references/audit-protocol.md', 'references/metrics-regression-case.md']) {
    const relative = join('.agents/skills/omniview-ui-implementation', file);
    await mkdir(dirname(join(root, relative)), { recursive: true });
    await writeFile(join(root, relative), await readFile(join(sourceRoot, relative)));
  }
  await writeFile(join(root, '.gitignore'), 'node_modules/\nevents.jsonl\ndriver.ts\n');
  await exec('git', ['init', '-q', root]);
  await exec('git', ['-C', root, 'add', '.']);
  await exec('git', ['-C', root, '-c', 'user.name=UI Audit Smoke', '-c', 'user.email=ui-audit-smoke@example.invalid', 'commit', '-qm', 'Isolated smoke baseline']);
  // This driver edits only its disposable fixture and records actual lifecycle events.
  const driver = `import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
export default function(pi) {
  const original = ${JSON.stringify(original)};
  let canRestore = process.env.OMP_UI_SMOKE_INDEPENDENT === '1';
  const record = (ctx, value) => appendFile(join(ctx.cwd, 'events.jsonl'), JSON.stringify(value) + '\\n');
  pi.on('tool_call',event=>{if(!['smoke_change','smoke_restore','ui_audit_snapshot','ui_audit_submit','task','read','grep','glob','eval'].includes(event.toolName))return {block:true,reason:'Isolated smoke permits only fixture, audit, and read-only inspection tools. Do not publish reports or change external state.'};});
  pi.registerTool({name:'smoke_change',label:'Change owned smoke fixture',description:'Add one harmless CSS rule to this disposable fixture.',parameters:pi.zod.object({}),async execute(_id,_args,_signal,_update,ctx){await writeFile(join(ctx.cwd,'ui/example.css'),original+'main { color: currentColor; }\\n');return {content:[{type:'text',text:'Fixture changed. Follow scenario steps; the driver checks restoration permission.'}]};}});
  pi.registerTool({name:'smoke_restore',label:'Restore owned smoke fixture',description:'Restore this disposable fixture after a real completion attempt, or after independent audit in the independent scenario.',parameters:pi.zod.object({}),async execute(_id,_args,_signal,_update,ctx){if(!canRestore){try{await readFile(join(ctx.cwd,'stop-observed'));canRestore=true;}catch{}}if(!canRestore)throw new Error('No session_stop observed yet. Finish attempt-one before restoring.');await writeFile(join(ctx.cwd,'ui/example.css'),original);return {content:[{type:'text',text:'Owned fixture restored; no UI changes remain.'}]};}});
  pi.on('tool_result',async(event,ctx)=>{await record(ctx,{event:event.toolName==='ui_audit_submit'?'submit_result':'tool_result',name:event.toolName,isError:Boolean(event.isError),result:event});});
}`;
  await writeFile(join(root, 'driver.ts'), driver);
  const prompt = 'This is an isolated audit-gate smoke, not an application audit. Call smoke_change, then ui_audit_snapshot. Attempt ui_audit_submit with report containing that snapshot, all four verdicts pass, empty findings/libraryRequests/unverified/evidence. Parent submission MUST be rejected. Then finish saying attempt-one. Do NOT call smoke_restore before completion-gate feedback. Once the gate blocks completion, call smoke_restore, call ui_audit_snapshot, and finish reporting restored with no visual approval claimed. Do not repeat submission, spawn agents, or edit any other files.';
  const run = exec(process.env.OMP_BIN || 'omp', ['--cwd', root, '--no-context-files', '--no-skills', '--no-session', '--no-tools', '--no-title', '--max-time', '90s', '-e', join(root, 'driver.ts'), '-p', prompt], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  // Print mode consumes piped stdin; close the unused pipe before awaiting exit.
  run.child.stdin.end();
  const { stdout, stderr } = await run;
  const events = (await readFile(join(root, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify({ passed: false, phase: 'parent-cycle', events, stdout, stderr }, null, 2)); }
  assert.ok(events.some(event => event.event === 'submit_result' && event.isError
    && event.result.content.some(item => /Only a direct omniview-ui-auditor child/.test(item.text ?? ''))),
  'Actual runtime must reject parent identity, not merely fail initialization');
  assert.ok(events.some(event => event.name === 'ui_audit_snapshot' && event.result.details?.required === true),
    'Actual runtime must initialize and detect the changed fixture');
  const stops = events.filter(event => event.event === 'session_stop');
  assert.ok(stops.some(event => event.changed), 'Actual runtime must attempt completion with changed UI');
  assert.equal(stops.at(-1)?.changed, false, 'Gate continuation must restore fixture before final completion');
  assert.equal(await readFile(join(root, 'ui/example.css'), 'utf8'), original);
  const independentPrompt = 'This is an isolated runtime test with no application server or visual baseline. Call smoke_change. Dispatch exactly one direct task child with agent omniview-ui-auditor. Tell it to read the implementation skill, call ui_audit_snapshot, inspect ui/example.css, and submit an honest report through ui_audit_submit: visualAcceptance must be unverified because no browser application or baseline exists. It must not invent evidence or claim approval. After the child returns, call smoke_restore and ui_audit_snapshot, then finish reporting that independent missing-evidence rejection was exercised. Do not attempt parent submission, retry the audit, launch an application, or edit other files. This test explicitly permits restoring the fixture after child rejection without waiting for completion-gate feedback.';
  const independentRun = exec(process.env.OMP_BIN || 'omp', ['--cwd', root, '--no-context-files', '--no-skills', '--no-session', '--tools', 'task', '--no-title', '--max-time', '150s', '-e', join(root, 'driver.ts'), '-p', independentPrompt], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, OMP_UI_SMOKE_INDEPENDENT: '1' } });
  independentRun.child.stdin.end();
  const independentOutput = await independentRun;
  const receiptRoot = join(root, '.git/ui-audit');
  const receiptNames = (await readdir(receiptRoot, { recursive: true })).filter(file => file.endsWith('.json'));
  const receipts = await Promise.all(receiptNames.map(async file => JSON.parse(await readFile(join(receiptRoot, file), 'utf8'))));
  const independentReceipt = receipts.find(receipt => receipt.auditor?.name === 'omniview-ui-auditor');
  assert.ok(independentReceipt, 'Actual named child must submit a persisted receipt');
  assert.equal(independentReceipt.accepted, false, 'Missing browser evidence must not produce approval');
  assert.ok(['high', 'xhigh', 'max'].includes(independentReceipt.auditor.thinkingLevel), 'Actual child must run at high effort');
  assert.equal(await readFile(join(root, 'ui/example.css'), 'utf8'), original);
  const result = { passed: true, scope: 'Actual OMP project discovery, snapshot tool, parent-submission rejection, blocking session_stop continuation, independent high-effort child submission rejected for missing visual evidence, restored baseline. Not browser/native visual acceptance or successful independent approval.', events, stdout, stderr, independent: { ...independentOutput, receipt: independentReceipt } };
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2)); }
  console.log(JSON.stringify(output ? {
    passed: true, scope: result.scope, stops, auditor: independentReceipt.auditor,
    independentApproval: independentReceipt.accepted, evidence: output,
  } : result, null, 2));
} catch (error) {
  let events = [];
  try { events = (await readFile(join(root, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch {}
  const failure = { passed: false, error: error.message, events, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(failure, null, 2)); }
  console.error(JSON.stringify(failure, null, 2));
  throw error;
} finally {
  await rm(root, { recursive: true, force: true });
}
