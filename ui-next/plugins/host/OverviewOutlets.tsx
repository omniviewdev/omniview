import { Button, menuTrigger, useMenu, type MenuAction } from '@omniviewdev/kit';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { OwnerDetailStrip } from '../../page/DetailPage';
import { DetailFocus } from './DetailFocus';
import { DetailFact, ScalarAnswer, invokeDetailFeature, type DetailInvocation } from './DetailScalar';
import { bindingLabel, overviewPoints, useDetailPoints, type DetailPoint } from './detailPlacements';
import type { DetailSelect } from './detailMenuTarget';
import type { DetailScope } from './detailScope';
import type { ExtensionBinding } from './extensionAuthority';
import { ExtensionMenuNavigationContext } from './extensionMenuNavigation';

type Resolve = (point: string, offer: string) => DetailSelect | undefined;
type Target = (row: ExtensionBinding) => DetailSelect | 'info' | 'sidebar' | undefined;
function OverviewMenu({ scope, point, target, accept }: {
  readonly scope: DetailScope; readonly point: DetailPoint; readonly target: Target; readonly accept: (binding: ExtensionBinding) => boolean;
}) {
  const { authority } = scope;
  const navigation = useContext(ExtensionMenuNavigationContext);
  const [selected, select] = useState<DetailInvocation>();
  useLayoutEffect(() => {
    if (!selected) {
      return;
    }

    const { demand } = selected;
    const clear = () => {
      select(before => before === selected ? undefined : before);
    };

    if (demand.signal.aborted) {
      clear();
    } else {
      demand.signal.addEventListener('abort', clear, { once: true });
    }

    return () => {
      demand.signal.removeEventListener('abort', clear); authority.endDemand(demand);
    };
  }, [authority, selected]);
  const rows = point.bindings;
  if (selected && !rows.includes(selected.demand.binding)) {
    select(undefined);
  }

  // Open menus keep their opening's snapshot. A newly arriving sibling need not disturb focus; a withdrawal must dismiss it.
  const [prior, setPrior] = useState({ rows, revision: 0 });
  const changed = prior.rows !== rows;
  const revision = changed && prior.rows.some(b => !rows.includes(b)) ? prior.revision + 1 : prior.revision;
  if (changed) {
    setPrior({ rows, revision });
  }

  const menu = useMenu(() => rows.map((row): MenuAction => ({
    kind: 'action', id: row.offer, label: bindingLabel(row, rows),
    onSelect: () => {
      if (!scope.current() || !authority.eligible(point.placement, accept).includes(row) || !scope.current()) {
        return;
      }

      const demand = authority.beginDemand(point.placement, row, accept);
      if (!demand) {
        return;
      }

      const allowed = () => scope.current() && authority.current(demand);
      if (!allowed()) {
        authority.endDemand(demand); return;
      }

      const at = target(row);
      if (typeof at === 'function') {
        at(allowed); authority.endDemand(demand);
      } else if (at === 'sidebar') {
        // Confirmation can be asynchronous. The originating placement and this exact demand still have to be live at dispatch.
        if (!navigation?.openSidebar(row, scope.connection, allowed)) {
          authority.endDemand(demand);
        }
      } else if (at === 'info') {
        select(invokeDetailFeature(scope, demand));
      } else {
        authority.endDemand(demand);
      }
    },
  })), revision);
  return <>
    {rows.length > 0 && <div><Button size="compact" variant="ghost" icon="ellipsis" {...menuTrigger(menu, String(point.placement.generation))}>{point.label}</Button></div>}
    {selected && point.bindings.includes(selected.demand.binding) && <ScalarAnswer key={selected.demand.generation} scope={scope} invocation={selected} label={selected.demand.binding.declaration.label} />}
  </>;
}

export function OverviewOutlets({ scope, content, strip, resolve }: {
  readonly scope: DetailScope; readonly content: NonNullable<OwnerDetailStrip['overview']>; readonly strip: OwnerDetailStrip; readonly resolve: Resolve;
}) {
  const navigation = useContext(ExtensionMenuNavigationContext);
  const target = useCallback<Target>(row => {
    const declaration = row.declaration;
    if (declaration.kind !== 'menu') {
      return undefined;
    }

    if (declaration.action.kind === 'info') {
      return 'info';
    }

    const { point, offer } = declaration.action;
    const peer = row.offer.slice(0, row.offer.indexOf('/'));
    return resolve(point, `${peer}/${offer}`) ?? (navigation?.canOpenSidebar(row, scope.connection) ? 'sidebar' : undefined);
  }, [resolve, navigation, scope.connection]);
  const accept = useCallback((binding: ExtensionBinding) => target(binding) !== undefined, [target]);
  const { requests, duplicate } = useMemo(() => overviewPoints(scope, content, accept), [scope, content, accept]);
  const { displayed: points } = useDetailPoints(scope, requests);
  useEffect(() => {
    if (duplicate) {
      console.warn(`[extensions] Ignored repeated Overview outlet ${duplicate}.`);
    }
  }, [duplicate]);
  const cards: Array<{ point: DetailPoint; row: ExtensionBinding }> = [];
  let menu: DetailPoint | undefined;
  for (const point of points) {
    if (point.bindings[0]?.placement === 'context-menu') {
      menu = point;
    } else {
      for (const row of point.bindings) {
        if (cards.length === 4) {
          break;
        }

        cards.push({ point, row });
      }
    }
  }

  const labels = cards.map(c => c.row);
  return <DetailFocus id={strip.id} selected={strip.selected}>
    {cards.map(({ point, row }) => <DetailFact key={`${point.placement.generation}/${row.generation}`} scope={scope} placement={point.placement} binding={row} label={bindingLabel(row, labels)} />)}
    {menu && <OverviewMenu key={menu.placement.generation} scope={scope} point={menu} target={target} accept={accept} />}
  </DetailFocus>;
}
