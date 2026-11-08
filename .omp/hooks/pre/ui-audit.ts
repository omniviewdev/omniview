import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AuditGate, instructions } from '../../../scripts/ui-audit/gate.mjs';
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent';

const exec = promisify(execFile);
// Factories are rebound for child sessions; only this routing registry is shared.
// Ambiguous parent identities fail closed rather than sharing approval across sessions.
const parents = new Map<string, Set<AuditGate>>();
export default function uiAudit(pi: ExtensionAPI) {
  let gate: AuditGate | undefined;
  let failure: string | undefined;
  let registryKey: string | undefined;
  let injected: string | undefined;
  const rootOf = async (cwd: string) => realpath((await exec('git', ['-C', cwd, 'rev-parse', '--show-toplevel'])).stdout.trim());
  async function owner(ctx: ExtensionContext) {
    if (ctx.agent.kind === 'main') {
      if (!gate) throw new Error(failure ?? 'UI audit session baseline is unavailable.');
      return gate;
    }
    const root = await rootOf(ctx.cwd);
    const candidates = new Set(parents.get(`${root}\0${ctx.agent.parentId}`) ?? []);
    if (!candidates.size) {
      for (const registered of parents.values()) {
        for (const candidate of registered) {
          if (candidate.parentId !== ctx.agent.parentId) continue;
          const pending = await candidate.pending();
          if (pending.roots.some((selected: { root: string }) => selected.root === root)) candidates.add(candidate);
        }
      }
    }
    if (candidates.size !== 1) throw new Error('No unique parent audit session found in this exact Git root or selected workspace membership. Dispatch auditor directly from the current parent session.');
    return [...candidates][0];
  }
  async function initialize(ctx: ExtensionContext) {
    if (ctx.agent.kind !== 'main') return;
    if (registryKey && gate) {
      const previous = parents.get(registryKey);
      previous?.delete(gate);
      if (!previous?.size) parents.delete(registryKey);
    }
    gate = undefined;
    failure = undefined;
    injected = undefined;
    try {
      const root = await rootOf(ctx.cwd);
      const sessionId = ctx.sessionManager.getSessionId();
      // Run the parser under project Node: OMP's bundled module resolver can miss pnpm aliases.
      // Register the gate before dependency loading so failures remain completion-blocking.
      const worker = fileURLToPath(new URL('../../../scripts/ui-audit/worker.mjs', import.meta.url));
      const checkFiles = async (selectedRoot: string, files: string[]) => {
        const { stdout } = await exec('node', [worker, selectedRoot, JSON.stringify(files)], { maxBuffer: 32 * 1024 * 1024 });
        return JSON.parse(stdout);
      };
      gate = new AuditGate(root, sessionId, ctx.agent.id, checkFiles);
      await gate.start();
      registryKey = `${root}\0${ctx.agent.id}`;
      const set = parents.get(registryKey) ?? new Set();
      set.add(gate); parents.set(registryKey, set);
    } catch (error) { gate = undefined; failure = `UI audit initialization failed: ${String(error)}. Fix the extension/checker, then restart the session.`; }
  }
  pi.on('session_start', (_event, ctx) => initialize(ctx));
  pi.on('session_switch', (_event, ctx) => initialize(ctx));
  pi.on('session_shutdown', () => {
    if (registryKey && gate) { const set = parents.get(registryKey); set?.delete(gate); if (!set?.size) parents.delete(registryKey); }
  });
  pi.on('before_agent_start', async (event, ctx) => {
    if (ctx.agent.kind !== 'main') return;
    if (/(?:\bUI\b|frontend|component|layout|style|react|css|screen|design)/i.test(event.prompt ?? '')) {
      return { message: { customType: 'ui-audit-policy', content: instructions, display: false } };
    }
  });
  pi.on('tool_result', async (event, ctx) => {
    // Early guidance is best-effort; the final filesystem snapshot covers every write path.
    if (ctx.agent.kind !== 'main' || !['edit', 'write', 'ast_edit', 'bash', 'eval', 'task'].includes(event.toolName)) return;
    try {
      const pending = await (await owner(ctx)).pending();
      if (pending.required && !pending.approved && injected !== pending.snapshot) {
        injected = pending.snapshot;
        return { additionalContext: instructions };
      }
    } catch (error) { return { additionalContext: `UI audit cannot evaluate edits: ${String(error)}` }; }
  });
  pi.on('tool_call', (event, ctx) => {
    if (ctx.agent.kind === 'sub' && ctx.agent.name === 'omniview-ui-auditor' && !['read', 'grep', 'glob', 'eval', 'browser', 'computer', 'ui_audit_snapshot', 'ui_audit_submit'].includes(event.toolName)) {
      return { block: true, reason: 'UI auditor must not edit source. Use read, grep, glob, eval/browser/computer, ui_audit_snapshot, ui_audit_submit for controlled inspection only.' };
    }
  });
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], details: value });
  pi.registerTool({
    name: 'ui_audit_snapshot', label: 'Inspect UI audit snapshot',
    description: 'Inspect pending UI snapshot. Direct omniview-ui-auditor child identity is bound by runtime; parent may inspect without gaining submission authority.',
    parameters: pi.zod.object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const current = await owner(ctx);
      const identity = { ...ctx.agent, thinkingLevel: pi.getThinkingLevel(), model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined };
      return result(ctx.agent.kind === 'main' ? await current.pending() : await current.inspect(identity));
    },
  });
  pi.registerTool({
    name: 'ui_audit_submit', label: 'Submit independent UI audit',
    description: 'Submit structured evidence-bound audit. Only a direct named independent auditor can submit. Required fields and evidence contract appear in ui_audit_snapshot guidance.',
    parameters: pi.zod.object({ report: pi.zod.unknown() }),
    async execute(_id, params, _signal, _update, ctx) {
      const identity = { ...ctx.agent, thinkingLevel: pi.getThinkingLevel(), model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined };
      return result(await (await owner(ctx)).submit(identity, params.report));
    },
  });
  pi.on('session_stop', async (_event, ctx) => {
    if (ctx.agent.kind !== 'main') return;
    try { return await (await owner(ctx)).stop(); }
    catch (error) { return { decision: 'block', reason: `${String(error)}\n${instructions}` }; }
  });
}
