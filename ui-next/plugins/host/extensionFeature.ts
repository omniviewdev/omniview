import type { ExtensionAuthority, ExtensionDemand } from './extensionAuthority';
import { EXTENSION_DEADLINE_MS, EXTENSION_TIMEOUT, loadExtensionFeature } from './extensionRoleLoader';
import { weigh } from './portSize';

export type ExtensionFeatureResult = { readonly label: string; readonly value: string } | { readonly text: string };
const unavailable = () => new Error('Feature unavailable');
const claimed = new WeakSet<ExtensionDemand>();
const timedOut = new WeakMap<readonly string[], number>();
const sections = new WeakMap<ExtensionAuthority, { active: number; readonly waiting: Set<() => void> }>();

/** At most four visible cards per Overview. Reserve one of two automatic lanes before code I/O; menus never enter this queue. */
async function reserveSection(authority: ExtensionAuthority, signal: AbortSignal): Promise<() => void> {
  const queue = sections.get(authority) ?? { active: 0, waiting: new Set<() => void>() };
  sections.set(authority, queue);
  return new Promise((resolve, reject) => {
    function take() {
      signal.removeEventListener('abort', cancel);
      queue.waiting.delete(take);
      queue.active++;
      resolve(() => {
        queue.active--;
        queue.waiting.values().next().value?.();
      });
    }

    function cancel() {
      queue.waiting.delete(take);
      reject(unavailable());
    }

    if (signal.aborted || queue.active + queue.waiting.size >= 4) {
      cancel();
    } else if (queue.active < 2) {
      take();
    } else {
      queue.waiting.add(take);
      signal.addEventListener('abort', cancel, { once: true });
    }
  });
}

/** Validate only this exact result. Traps can invalidate authority; never read a getter, stringify a peer object or inspect an exception. */
function scalarResult(raw: unknown, section: boolean, check: () => void): ExtensionFeatureResult {
  check();
  if (!raw || typeof raw !== 'object') {
    throw unavailable();
  }

  const prototype: unknown = Object.getPrototypeOf(raw);
  check();
  if (prototype !== null && prototype !== Object.prototype) {
    throw unavailable();
  }

  const keys = Reflect.ownKeys(raw);
  check();
  if (section ? keys.length !== 2 || !keys.includes('label') || !keys.includes('value') : keys.length !== 1 || keys[0] !== 'text') {
    throw unavailable();
  }

  function text(key: string, limit: number) {
    const entry = Object.getOwnPropertyDescriptor(raw, key);
    check();
    if (!entry?.enumerable || !Object.hasOwn(entry, 'value') || typeof entry.value !== 'string' || entry.value.length > limit) {
      throw unavailable();
    }

    return entry.value;
  }

  const result = section ? { label: text('label', 256), value: text('value', 4096) } : { text: text('text', 4096) };
  if (typeof weigh(result, 16 * 1024, 4096) !== 'number') {
    throw unavailable();
  }

  return Object.freeze(result);
}

/** One explicit information choice or one admitted visible card. Code can be shared; a call, result or error never is. */
export async function evaluateExtensionFeature(
  authority: ExtensionAuthority, demand: ExtensionDemand, authorize?: () => Promise<boolean>,
): Promise<ExtensionFeatureResult> {
  if (document.hidden || claimed.has(demand) || !authority.current(demand)) {
    throw unavailable();
  }

  const { binding, signal } = demand;
  const declaration = binding.declaration;
  const section = declaration.kind === 'section' && binding.placement === 'overview-section';
  if (!section && !(declaration.kind === 'menu' && declaration.action.kind === 'info' && binding.placement === 'context-menu')) {
    throw unavailable();
  }

  claimed.add(demand);
  if (timedOut.has(binding.featureExports)) {
    throw unavailable();
  }

  const work = new AbortController();
  const retire = () => {
    work.abort();
  };

  const hide = () => {
    if (document.hidden) {
      authority.endDemand(demand);
    }
  };

  const check = () => {
    if (work.signal.aborted || signal.aborted || document.hidden || !authority.current(demand)) {
      throw unavailable();
    }
  };

  let invoking = false;
  let quarantined = false;
  let release: (() => void) | undefined;
  let refuse: (() => void) | undefined;
  signal.addEventListener('abort', retire, { once: true });
  document.addEventListener('visibilitychange', hide);
  const timer = setTimeout(() => {
    if (invoking) {
      quarantined = true;
      timedOut.set(binding.featureExports, (timedOut.get(binding.featureExports) ?? 0) + 1);
    }

    work.abort(EXTENSION_TIMEOUT);
  }, EXTENSION_DEADLINE_MS);

  async function evaluate() {
    const call = await loadExtensionFeature(authority, demand, work.signal);
    check();
    // A sibling may have timed out while this caller was queued or sharing the role load.
    if (timedOut.has(binding.featureExports)) {
      throw unavailable();
    }

    if (authorize) {
      // A cold role load can outlive the terminal's native resource or grant. Authorize the exact row before disclosing input.
      if (!(await authorize())) {
        throw unavailable();
      }

      check();
      if (timedOut.has(binding.featureExports)) {
        throw unavailable();
      }
    }

    invoking = true;
    try {
      const raw: unknown = call(demand.input, work.signal);
      // Do not let the Promise assimilation algorithm read a surplus `then` getter on a synchronous scalar record.
      // Real PromiseLike results settle first; an obsolete settlement is never inspected, even if it's a proxy.
      const primary = section ? 'label' : 'text';
      let direct: boolean;
      try {
        check();
        direct = raw !== null && typeof raw === 'object' && Object.hasOwn(raw, primary);
        check();
      } catch {
        // A provider or descriptor trap can synchronously withdraw its own invocation. Do not look up `then` on its
        // obsolete result. Observe a genuine, already-started Promise's rejection without assimilating a stale thenable.
        try {
          void Promise.prototype.then.call(raw, undefined, () => undefined);
        } catch { /* Not a native Promise. */ }

        throw unavailable();
      }

      const result: unknown = direct ? raw : await raw;
      return scalarResult(result, section, check);
    } finally {
      invoking = false;
      if (quarantined) {
        const remaining = timedOut.get(binding.featureExports)! - 1;
        if (remaining) {
          timedOut.set(binding.featureExports, remaining);
        } else {
          timedOut.delete(binding.featureExports);
        }
      }
    }
  }

  let result: ExtensionFeatureResult;
  try {
    if (section) {
      release = await reserveSection(authority, work.signal);
    }

    check();
    const stopped = new Promise<never>((_, reject) => {
      refuse = () => {
        reject(unavailable());
      };

      work.signal.addEventListener('abort', refuse, { once: true });
    });
    result = await Promise.race([evaluate(), stopped]);
    check();
  } catch {
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', retire);
    document.removeEventListener('visibilitychange', hide);
    if (refuse) {
      work.signal.removeEventListener('abort', refuse);
    }

    release?.();
    work.abort(); // The scalar was copied or rejected. A completed invocation has no continuing authority.
  }

  // A cooperative abort listener can synchronously revoke this grant. Do not publish even a validated, copied result then.
  if (document.hidden || signal.aborted || !authority.current(demand)) {
    throw unavailable();
  }

  return result;
}
