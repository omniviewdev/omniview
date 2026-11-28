import { TabPanel, Tabs, type TabsItem } from '@omniviewdev/kit';
import type { ExtensionRootV1 } from '@omniviewdev/runtime/ui/v1';
import { useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import type { OwnerDetailStrip } from '../../page/DetailPage';
import { DetailFocus } from './DetailFocus';
import { OverviewOutlets } from './OverviewOutlets';
import { ExtensionView } from './ExtensionView';
import { attachDetailTarget } from './detailMenuTarget';
import { bindingLabel, detailTabPoint, useDetailPoints, type DetailPoint } from './detailPlacements';
import { ownData, useDetailScope, type DetailHost } from './detailScope';
import type { ExtensionBinding, ExtensionPlacement } from './extensionAuthority';
import { ExtensionMenuNavigationContext } from './extensionMenuNavigation';

type Face = TabsItem & { readonly binding: ExtensionBinding };
type Selection = { readonly placement: ExtensionPlacement; readonly offer: string; readonly generation: number; readonly focusPanel: boolean };
const NO_FACES: readonly Face[] = [];

function tabFaces(owner: readonly TabsItem[], point: DetailPoint | undefined): readonly Face[] {
  if (!point) {
    return NO_FACES;
  }

  const ids = new Set(owner.map(t => t.id));
  const labels = new Set(owner.map(t => t.label));
  return point.bindings.map(binding => {
    // The shell reserves no public owner ID. Keep all owner tabs first and unchanged, including future and deliberately similar IDs.
    let id = `~view/${binding.point}/${binding.offer}`;
    while (ids.has(id)) {
      id = `~${id}`;
    }

    return { binding, id, label: bindingLabel(binding, point.bindings, labels) };
  });
}

/** Only the strip and its one tabpanel change. No document navigation, peer page hook or persisted peer selection. */
export function DetailOutlets({ strip, ...host }: DetailHost & { readonly strip: OwnerDetailStrip }) {
  const { scope, pending } = useDetailScope(host);
  const requests = useMemo(() => detailTabPoint(scope, host.source.view), [scope, host.source.view]);
  const { displayed, snapshot } = useDetailPoints(scope, requests);
  const point = displayed[0];
  const navigation = useContext(ExtensionMenuNavigationContext);
  const faces = tabFaces(strip.tabs, point);
  const [choice, choose] = useState<Selection>();
  const selected = choice?.placement === point?.placement && choice
    ? faces.find(face => face.binding.offer === choice.offer && face.binding.selectionGeneration === choice.generation) : undefined;
  // Re-admission, replacement and A → B → A must not reselect an obsolete choice.
  if (choice && !selected) {
    choose(undefined);
  }

  const resolve = useCallback((qualifiedPoint: string, offer: string) => {
    if (!scope || point?.placement.point !== qualifiedPoint || !scope.current()) {
      return undefined;
    }

    const row = point.bindings.find(b => b.offer === offer);
    if (!row || !scope.authority.eligible(point.placement).includes(row)) {
      return undefined;
    }

    return (stillAllowed?: () => boolean) => {
      if (!scope.current() || !scope.authority.eligible(point.placement).includes(row) || !scope.current() ||
          (stillAllowed !== undefined && !stillAllowed()) || !scope.authority.point(qualifiedPoint).includes(row) || !scope.current()) {
        return false;
      }

      choose({ placement: point.placement, offer, generation: row.selectionGeneration, focusPanel: true });
      return true;
    };
  }, [scope, point, choose]);
  const { tabs, tabId, route, source } = host;
  useLayoutEffect(() => {
    // A layout reconciliation may just have queued a more current membership. Let that commit own the one-use handoff.
    if (snapshot() !== displayed || document.hidden || source.state.kind === 'loading' || pending) {
      return;
    }

    const here = tabs.getSnapshot();
    if (here.active !== tabId || here.tabs[tabId]?.location.route !== route) {
      return;
    }

    const detach = scope && point && scope.current() ? attachDetailTarget({ scope, resolve }) : undefined;
    navigation?.onDetailReady(tabId, scope?.current() ? scope : undefined);
    return detach;
  }, [scope, pending, point, resolve, displayed, snapshot, navigation, tabs, tabId, route, source]);
  const peerId = selected?.id;
  useLayoutEffect(() => {
    if (choice?.focusPanel && peerId && scope?.current()) {
      document.getElementById(`${strip.id}-panel`)?.focus({ preventScroll: true });
    }
  }, [choice, strip.id, peerId, scope]);

  const selectedId = selected?.id ?? strip.selected;
  return <DetailFocus id={strip.id} selected={selectedId}>
    <Tabs id={strip.id} label={strip.label} tabs={point ? [...strip.tabs, ...faces] : strip.tabs} selected={selectedId} onSelect={id => {
      const peer = faces.find(face => face.id === id);
      if (peer && point && scope) {
        if (scope.current() && scope.authority.eligible(point.placement).includes(peer.binding) && scope.current()) {
          choose({ placement: point.placement, offer: peer.binding.offer, generation: peer.binding.selectionGeneration, focusPanel: false });
        }
      } else if (strip.tabs.some(tab => tab.id === id)) {
        choose(undefined);
        strip.onSelect(id);
      }
    }} />
    <TabPanel id={strip.id} selected={selectedId}>
      {selected && point ? <ExtensionView key={`${point.placement.generation}/${selected.binding.generation}`} placement={point.placement} binding={selected.binding}
        root={selected.binding.read ? ownData(host.source.view, 'extensionRoot') as ExtensionRootV1 | undefined : undefined} />
        : strip.panel(scope && strip.overview && <OverviewOutlets key={strip.selected} scope={scope} content={strip.overview} strip={strip} resolve={resolve} />)}
    </TabPanel>
  </DetailFocus>;
}
