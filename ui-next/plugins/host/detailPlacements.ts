import { isExtensionIdSegment } from '@omniviewdev/runtime/internal/extensions-v1';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import type { ExtensionBinding, ExtensionPlacement } from './extensionAuthority';
import { ownData, type DetailScope } from './detailScope';

type Surface = 'detail-tab' | 'overview-section' | 'context-menu';
type DetailRequest = { readonly point: string; readonly surface: Surface; readonly context: unknown; readonly accept?: (binding: ExtensionBinding) => boolean };
export type DetailPoint = { readonly placement: ExtensionPlacement; readonly label: string; readonly bindings: readonly ExtensionBinding[] };
type Slot = { readonly holder: Record<string, unknown>; readonly stop: () => void; request: DetailRequest; point?: DetailPoint; revision: number };
const EMPTY: readonly DetailPoint[] = Object.freeze([]);
const NONE: readonly DetailRequest[] = Object.freeze([]);

function request(scope: DetailScope, surface: Surface, adapter: unknown): DetailRequest | undefined {
  try {
    if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter) || Reflect.ownKeys(adapter).length !== 2) {
      return undefined;
    }

    const local = ownData(adapter, 'point');
    if (!isExtensionIdSegment(local)) {
      return undefined;
    } // Never resolve a foreign qualified name or a plugin-provided path.

    const context = ownData(adapter, 'context');
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      return undefined;
    }

    return { surface, point: `${scope.owner}/${local}`, context };
  } catch {
    return undefined;
  }
}

export function detailTabPoint(scope: DetailScope | undefined, view: unknown): readonly DetailRequest[] {
  const tab = scope && request(scope, 'detail-tab', ownData(view, 'tabOutlet'));
  return tab ? [tab] : NONE;
}

/** Consult only the bounded owner list. Do not iterate or enumerate an author's projection. */
export function overviewPoints(scope: DetailScope, content: unknown, accept: (binding: ExtensionBinding) => boolean): { requests: readonly DetailRequest[]; duplicate: string | undefined } {
  const requests: DetailRequest[] = [];
  let duplicate: string | undefined;
  const entries = ownData(content, 'outlets');
  try {
    if (Array.isArray(entries)) {
      const length = ownDataLength(entries);
      for (let i = 0; i < Math.min(length, 4); i++) {
        const item = request(scope, 'overview-section', ownData(entries, String(i)));
        if (!item) {
          continue;
        }

        if (requests.some(r => r.point === item.point)) {
          duplicate ??= item.point;
        } else {
          requests.push(item);
        }
      }
    }
  } catch { /* A malformed section list cannot withdraw the separate menu or the ordinary Overview. */ }

  const menu = request(scope, 'context-menu', ownData(content, 'menuOutlet'));
  if (menu) {
    requests.push({ ...menu, accept });
  }

  return { requests, duplicate };
}

function ownDataLength(entries: readonly unknown[]): number {
  const length: unknown = Object.getOwnPropertyDescriptor(entries, 'length')?.value;
  return typeof length === 'number' && Number.isInteger(length) && length >= 0 ? length : 0;
}

/** One visible strip or Overview. Subscribe to its points only; keep leases keyed by point across owner renders and reordering. */
class DetailPoints {
  readonly #slots = new Map<string, Slot>();
  readonly #listeners = new Set<() => void>();
  #wanted: readonly DetailRequest[] = NONE;
  #order: readonly DetailRequest[] = NONE;
  #published = EMPTY;
  constructor(private readonly scope: DetailScope | undefined) {}

  readonly subscribe = (notify: () => void) => {
    this.#listeners.add(notify);
    return () => {
      this.#listeners.delete(notify);
    };
  };

  readonly snapshot = () => this.#published;

  update(next: readonly DetailRequest[]): void {
    this.#wanted = next;
    this.#apply(next.length && this.scope?.current() ? next : NONE);
  }

  /** Synchronously retire on hide or connection loss. Pending native replies do not wait for React to unmount. */
  attach(): () => void {
    const scope = this.scope;
    let visible = scope?.current() ?? false;
    const stop = scope?.watch(() => {
      const current = scope.current();
      if (visible === current) {
        return;
      }

      visible = current;
      this.#apply(current ? this.#wanted : NONE);
    });
    return () => {
      stop?.();
      this.update(NONE);
    };
  }

  #apply(next: readonly DetailRequest[]): void {
    const scope = this.scope;
    if (!scope || this.#order === next) {
      return;
    }

    this.#order = next;
    for (const [key, slot] of this.#slots) {
      if (!next.some(request => request.point === slot.request.point && request.surface === slot.request.surface)) {
        this.#slots.delete(key);
        slot.stop();
        scope.authority.setPlacement(slot.holder, undefined);
      }
    }

    for (const wanted of next) {
      const key = `${wanted.surface}:${wanted.point}`;
      let slot = this.#slots.get(key);
      if (!slot) {
        const stop = scope.authority.subscribePoint(wanted.point, () => {
          this.#scan(key);
          this.#publish();
        });
        slot = { holder: {}, stop, request: wanted, revision: 0 };
        this.#slots.set(key, slot);
      }

      slot.request = wanted;
      this.#scan(key);
    }

    this.#publish();
  }

  #scan(key: string): void {
    const scope = this.scope;
    const slot = this.#slots.get(key);
    if (!slot || !scope) {
      return;
    }

    const rev = ++slot.revision;
    const { authority } = scope;
    const { surface, point, context } = slot.request;
    const info = authority.declaredPoint(point);
    const eligible = info?.ownerPin === scope.artifact.pin && info.sourceGeneration === scope.artifact.generation &&
      info.declaration.placement === surface && authority.point(point).length && scope.current();
    const placement = authority.setPlacement(slot.holder, eligible ? {
      owner: scope.owner, point, context, placement: surface, ready: true, visible: true, connection: scope.connection,
      subject: scope.owner, visit: scope.visit, scopeKey: scope.extensionScopeKey,
    } : undefined);
    const bindings = placement && authority.eligible(placement, slot.request.accept);
    if (this.#slots.get(key) !== slot || rev !== slot.revision) {
      return;
    } // A descriptor trap can reenter an observer.

    if (!placement || !info || !bindings?.length || !scope.current()) {
      delete slot.point;
      return;
    }

    const prior = slot.point;
    if (prior?.placement === placement && prior.bindings.length === bindings.length && bindings.every((b, i) => b === prior.bindings[i])) {
      return;
    }

    slot.point = { placement, label: info.declaration.label, bindings };
  }

  #publish(): void {
    const rows: DetailPoint[] = [];
    for (const request of this.#order) {
      const point = this.#slots.get(`${request.surface}:${request.point}`)?.point;
      if (point) {
        rows.push(point);
      }
    }

    if (this.#published.length === rows.length && rows.every((p, i) => p === this.#published[i])) {
      return;
    }

    this.#published = rows.length ? rows : EMPTY;
    for (const notify of this.#listeners) {
      notify();
    }
  }
}
export function useDetailPoints(scope: DetailScope | undefined, requests: readonly DetailRequest[]) {
  const points = useMemo(() => new DetailPoints(scope), [scope]);
  useLayoutEffect(() => points.attach(), [points]);
  useLayoutEffect(() => {
    points.update(requests);
  }, [points, requests]);
  const displayed = useSyncExternalStore(points.subscribe, points.snapshot);
  return { displayed, snapshot: points.snapshot };
}

export function bindingLabel(binding: ExtensionBinding, rows: readonly ExtensionBinding[], reserved?: ReadonlySet<string>): string {
  const label = binding.declaration.label;
  const used = (name: string) => (reserved?.has(name) ?? false) || rows.some(b => b !== binding && b.declaration.label === name);
  if (!used(label)) {
    return label;
  }

  const qualifier = rows.some(b => b !== binding && b.offer === binding.offer) ? `${binding.point} · ${binding.offer}` : binding.offer;
  let distinct = `${label} (${qualifier})`;
  while (used(distinct)) {
    distinct += ` (${qualifier})`;
  }

  return distinct;
}
