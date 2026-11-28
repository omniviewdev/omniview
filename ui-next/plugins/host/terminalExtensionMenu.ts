import type { MenuItem, MenuSource } from '@omniviewdev/kit';
import { subscribeExtensionRoot } from '@omniviewdev/runtime/internal/extensions-v1';
import type { PanelStore } from '../../shell/core/panel';
import type { TabsStore } from '../../shell/core/tabs';
import { navigationOrigin, staleOrigin } from '../../shell/core/tabs/state';
import { focusPage, focusPanel } from '../../shell/panel/focus';
import type { TerminalSessions } from '../../shell/panel/terminal/TerminalSessions';
import type { TerminalMenuOriginV1, TerminalMenuOutletV1 } from '../contract/v1';
import type { ExtensionAuthority, ExtensionBinding, ExtensionDemand, ExtensionPlacement } from './extensionAuthority';
import { evaluateExtensionFeature } from './extensionFeature';
import { menuDestination, type ExtensionMenuNavigation } from './extensionMenuNavigation';
import { subscribeDetailTarget } from './detailMenuTarget';
import type { ResourceShells } from './resourceShells';

export type TerminalMenuOpening = {
  readonly key: number; readonly title: string; readonly origin: TerminalMenuOriginV1;
  readonly useOutlet: (origin: TerminalMenuOriginV1) => TerminalMenuOutletV1 | undefined;
  readonly publish: (outlet: TerminalMenuOutletV1 | undefined, navigation: ExtensionMenuNavigation | null) => void;
};
type Snapshot = { readonly opening: TerminalMenuOpening; readonly status?: string } | null;
export type TerminalExtensionMenu = {
  readonly open: (id: string, surface: TerminalMenuOriginV1['surface'], builtins: readonly MenuItem[]) => readonly MenuItem[] | MenuSource;
  readonly getSnapshot: () => Snapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dismiss: () => void;
};
type Dependencies = {
  readonly shells: ResourceShells; readonly panel: PanelStore; readonly sessions: TerminalSessions; readonly authority: ExtensionAuthority;
  readonly tabs?: Pick<TabsStore, 'getSnapshot' | 'subscribe'>;
  readonly evaluate?: typeof evaluateExtensionFeature;
};
const rowId = (binding: ExtensionBinding) => `extension:${binding.point}:${binding.offer}`;
const same = (a: readonly ExtensionBinding[], b: readonly ExtensionBinding[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/** The menu and its selected result own at most one adapter for this window. Opening native rows needs no I/O. */
export function createTerminalExtensionMenu({ shells, panel, sessions, authority, tabs, evaluate = evaluateExtensionFeature }: Dependencies): TerminalExtensionMenu {
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = null, retire: (() => void) | undefined, serial = 0;
  function show(next: Snapshot) {
    snapshot = next; for (const listener of listeners) {
      listener();
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener); return () => {
        listeners.delete(listener);
      };
    },
    dismiss() {
      retire?.();
    },
    open(id, surface, builtins) {
      retire?.();
      const feed = sessions.feedOf(id);
      const bound = feed && shells.originOf(feed);
      const useOutlet = bound?.entry.contribution.panel?.sessions?.terminal?.useMenuOutlet;
      const artifact = bound?.entry.artifact;
      if (!bound || !feed || !useOutlet || !artifact || !authority.hasMenuBindings(bound.entry.id, artifact.generation)) {
        return builtins;
      }

      const { entry, route, connection, extensionScopeKey, verify } = bound;
      const launch = bound;
      const key = ++serial;
      const visit = {}, holder = {};
      const from = tabs && navigationOrigin(tabs.getSnapshot());
      const lifetime = new AbortController();
      const origin = Object.freeze({ surface, route, connection, extensionScopeKey }); // Exact owner input, not a spread of the private provenance.
      let placement: ExtensionPlacement | undefined, demand: ExtensionDemand | undefined;
      let bindings: readonly ExtensionBinding[] = [];
      let phase: 'menu' | 'selected' | 'closed' = 'menu';
      let chosen: ExtensionBinding | undefined, invoked = false, verified = false;
      let witness: ReturnType<typeof launch.witnessOf>;
      const verifyFacts = async () => witness !== undefined && await witness.verify(lifetime.signal);
      let handed: ExtensionBinding | undefined;
      let update: ((items: readonly MenuItem[] | null) => void) | undefined;
      let navigation: ExtensionMenuNavigation | null = null;
      const stops: Array<() => void> = [];
      let stopPoint: (() => void) | undefined;
      const targetStops = new Map<string, () => void>();
      const destinations = new Map<ExtensionBinding, ExtensionBinding>();
      let stopDetail: (() => void) | undefined, stopVisit: (() => void) | undefined;
      const session = () => panel.selectors.session(panel.getSnapshot(), id);
      const current = () => {
        const state = panel.getSnapshot(), clicked = panel.selectors.session(state, id);
        // All session tabs of the shown tool are targets; a body must be on screen, even when its sibling pane is active.
        const visible = surface === 'session-tab' ? panel.selectors.shown(state)?.tool === 'terminal' : panel.selectors.isShown(state, id);
        return phase !== 'closed' && !document.hidden && visible &&
          clicked?.tool === 'terminal' && clicked.plugin === entry.id && clicked.state === 'running' && sessions.feedOf(id) === feed &&
          shells.originOf(feed) === bound && bound.current() && (!witness || witness.current()) && authority.hasMenuBindings(entry.id, artifact.generation);
      };

      if (!current()) {
        return builtins;
      }

      function close() {
        if (phase === 'closed') {
          return;
        }

        const menuOwnedFocus = phase === 'menu' && !!document.activeElement?.closest('[role="menu"]');
        phase = 'closed';
        lifetime.abort();
        for (const stop of stops.splice(0)) {
          stop();
        }

        stopPoint?.(); for (const stop of targetStops.values()) {
          stop();
        }

        targetStops.clear();
        stopDetail?.(); stopVisit?.(); destinations.clear();
        if (placement) {
          authority.endPlacement(placement);
        }

        if (retire === close) {
          retire = undefined; show(null);
        }

        const dismiss = update; update = undefined; dismiss?.(null);
        if (menuOwnedFocus) {
          queueMicrotask(() => {
          // Kit restores a live trigger. A synchronous session close can remove that trigger in React's subsequent commit.
            if (document.activeElement === document.body && !document.hidden && !focusPanel()) {
              focusPage();
            }
          });
        }
      }

      function targetOf(binding: ExtensionBinding) {
        const d = binding.declaration;
        if (d.kind !== 'menu' || d.action.kind !== 'openView' || !d.action.point.startsWith(`${entry.id}/`)) {
          return undefined;
        }

        const point = d.action.point;
        const kind = authority.declaredPoint(point)?.declaration.placement;
        return kind === 'sidebar' || kind === 'detail-tab' ? menuDestination(binding, authority.point(point), kind) : undefined;
      }

      function eligible(binding: ExtensionBinding) {
        const d = binding.declaration;
        if (!current() || d.kind !== 'menu') {
          return false;
        }

        if (d.action.kind === 'info') {
          return true;
        }

        const target = targetOf(binding);
        if (!target) {
          return false;
        }

        if (destinations.has(binding) && target !== destinations.get(binding)) {
          return false;
        }

        // Once an authorized navigation starts, its owner page may still be loading. It must independently admit the pinned target.
        if (binding === chosen && handed) {
          return handed === target;
        }

        if (tabs && staleOrigin(tabs.getSnapshot(), from)) {
          return false;
        }

        return target.placement === 'sidebar' ? navigation?.canOpenSidebar(binding, connection) === true : navigation?.canOpenDetail(binding, launch) === true;
      }

      function selected(binding: ExtensionBinding) {
        return phase === 'selected' && chosen === binding && current() && placement !== undefined && authority.eligible(placement, eligible).includes(binding) && demand !== undefined && authority.current(demand);
      }

      async function select(binding: ExtensionBinding) {
        if (invoked || chosen !== binding || phase !== 'selected') {
          return;
        }

        invoked = true;
        if (!placement || !current() || !authority.eligible(placement, eligible).includes(binding)) {
          close(); return;
        }

        // Capture the granted projection now, not after a round trip. Changed predicates, fields or authority abort this demand.
        demand = authority.beginDemand(placement, binding, eligible);
        if (!demand || !selected(binding)) {
          close(); return;
        }

        demand.signal.addEventListener('abort', close, { once: true });
        const d = binding.declaration;
        if (d.kind !== 'menu') {
          close(); return;
        }

        if (d.action.kind === 'info') {
          show({ opening, status: 'Loading information…' });
        }

        try {
          if (!await verifyFacts() || !selected(binding)) {
            close(); return;
          }

          if (d.action.kind === 'openView') {
            handed = destinations.get(binding);
            const sourceCurrent = () => current() && !!demand && authority.current(demand);
            if (!handed || !navigation || !(handed.placement === 'sidebar' ? navigation.openSidebar(binding, connection, sourceCurrent) : navigation.openDetail(binding, launch, sourceCurrent))) {
              close();
            }

            return;
          }

          const result = await evaluate(authority, demand, verifyFacts);
          if (!selected(binding) || !await verifyFacts() || !selected(binding)) {
            close(); return;
          }

          show({ opening, status: 'text' in result ? result.text : 'Information unavailable.' });
        } catch {
          if (selected(binding) && await verifyFacts() && selected(binding)) {
            show({ opening, status: 'Information unavailable.' });
          } else {
            close();
          }
        }
      }

      function refresh() {
        if (!current()) {
          close(); return;
        }

        if (phase === 'selected') {
          if (chosen && demand && !selected(chosen)) {
            close();
          }

          return;
        }

        const targetPoints = new Set<string>();
        let needsDetail = false;
        const next = placement ? authority.eligible(placement, binding => {
          const d = binding.declaration;
          if (d.kind === 'menu' && d.action.kind === 'openView' && d.action.point.startsWith(`${entry.id}/`)) {
            targetPoints.add(d.action.point);
            if (authority.declaredPoint(d.action.point)?.declaration.placement === 'detail-tab') {
              needsDetail = true;
            }
          }

          return eligible(binding);
        }) : [];
        for (const [point, stop] of targetStops) {
          if (!targetPoints.has(point)) {
            stop(); targetStops.delete(point);
          }
        }

        for (const point of targetPoints) {
          if (!targetStops.has(point)) {
            targetStops.set(point, authority.subscribePoint(point, refresh));
          }
        }

        if (needsDetail) {
          stopDetail ??= subscribeDetailTarget(authority, refresh);
        } else {
          stopDetail?.(); stopDetail = undefined;
        }

        if (tabs && targetPoints.size) {
          stopVisit ??= tabs.subscribe(refresh);
        } else {
          stopVisit?.(); stopVisit = undefined;
        }

        if (same(bindings, next)) {
          return;
        }

        // Never let a stale opening acquire a replacement for a row that was already offered.
        if (bindings.some(row => !next.includes(row))) {
          close(); return;
        }

        for (const row of next) {
          if (!destinations.has(row)) {
            const target = targetOf(row); if (target) {
              destinations.set(row, target);
            }
          }
        }

        bindings = next;
        const labels = new Map<string, number>();
        for (const item of builtins) {
          if ('label' in item && typeof item.label === 'string') {
            labels.set(item.label, 1);
          }
        }

        for (const { declaration: { label } } of bindings) {
          labels.set(label, (labels.get(label) ?? 0) + 1);
        }

        const items: MenuItem[] = [...builtins, { id: 'extension:separator', kind: 'separator' }];
        for (const row of bindings) {
          items.push({ id: rowId(row), kind: 'action', label: labels.get(row.declaration.label) === 1 ? row.declaration.label : `${row.declaration.label} (${row.offer})`, onSelect: () => {
            void select(row);
          } });
        }

        update?.(items);
      }

      const opening: TerminalMenuOpening = { key, title: panel.selectors.sessionItem(panel.getSnapshot(), id)?.name ?? session()?.title ?? '', origin, useOutlet,
        publish(value, nav) {
          if (!verified || !current()) {
            close(); return;
          }

          navigation = nav;
          const point = value && `${entry.id}/${value.outlet.point}`;
          const info = point && authority.declaredPoint(point);
          if (value?.extensionScopeKey !== extensionScopeKey || !point || !info || info.ownerPin !== artifact.pin || info.sourceGeneration !== artifact.generation || info.declaration.placement !== 'context-menu') {
            if (placement) {
              close();
            }

            return;
          }

          if (placement && placement.point !== point) {
            close(); return;
          }

          const root = value.extensionRoot;
          if (witness && witness.root !== root) {
            close(); return;
          }

          if (!witness) {
            witness = launch.witnessOf(root);
            if (!witness) {
              return;
            }

            stops.push(subscribeExtensionRoot(root, close));
            if (!witness.current()) {
              close(); return;
            }
          }

          placement = authority.setPlacement(holder, { point, owner: entry.id, placement: 'context-menu', scopeKey: extensionScopeKey, ready: true, visible: true,
            subject: id, connection, visit, context: value.outlet.context });
          if (!placement) {
            close(); return;
          }

          stopPoint ??= authority.subscribePoint(point, refresh);
          refresh();
        },
      };
      return { items: builtins, subscribe(notify) {
        retire?.(); retire = close; update = notify;
        const lost = () => {
          if (!current()) {
            close();
          }
        };

        const hide = () => {
          if (document.hidden) {
            close();
          }
        };

        document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', close); window.addEventListener('blur', close);
        stops.push(() => {
          document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', close); window.removeEventListener('blur', close);
        },
        panel.subscribe(lost), sessions.subscribeFeeds(lost), bound.onRetire(close), authority.subscribeMenuBindings(entry.id, artifact.generation, lost));
        if (!current()) {
          close();
        } else {
          void verify(lifetime.signal).then(ok => {
            if (phase !== 'menu') {
              return;
            }

            if (!ok) {
              update = undefined; close(); return;
            } // No verified projection was ever offered. Leave the native menu in place.

            if (!current()) {
              close(); return;
            }

            verified = true; show({ opening });
          }, () => {
            update = undefined; close();
          });
        }

        return (choice?: string) => {
          update = undefined;
          chosen = choice === undefined ? undefined : bindings.find(row => rowId(row) === choice);
          if (!chosen || phase !== 'menu' || !current()) {
            close(); return;
          }

          phase = 'selected';
          const superseded = (e: FocusEvent) => {
            if (e.target instanceof Element && e.target.closest('[role="menu"]')) {
              close();
            }
          };

          document.addEventListener('focusin', superseded);
          stops.push(() => {
            document.removeEventListener('focusin', superseded);
          });
        };
      } };
    },
  };
}
