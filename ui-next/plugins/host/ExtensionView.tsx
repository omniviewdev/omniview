import { Button, LinkProvider, Notice, type LinkHandler } from '@omniviewdev/kit';
import type { ExtensionRootV1 } from '@omniviewdev/runtime/ui/v1';
import { QueryClientContext } from '@tanstack/react-query';
import { Component, createRef, Suspense, useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ContextType, type ReactElement, type ReactNode } from 'react';
import { NoticesProvider } from '../../shell/notices/context';
import { PaletteProvider } from '../../shell/palette/context';
import { PanelProvider } from '../../shell/panel/context';
import { SettingsProvider } from '../../shell/settings/context';
import { TabsProvider } from '../../shell/tabs/context';
import { EXTENSION_INPUT_CHANGED, type ExtensionAuthority, type ExtensionBinding, type ExtensionDemand, type ExtensionPlacement } from './extensionAuthority';
import { ExtensionAuthorityContext } from './extensionAuthorityContext';
import { ExtensionMenuNavigationContext } from './extensionMenuNavigation';
import { useExtensionRelated } from './extensionRelated';
import { loadExtensionBody, EXTENSION_DEADLINE_MS, type ExtensionBody } from './extensionRoleLoader';

type Props = {
  /** The foreground outlet owns both handles. Never derive either from a tab title, route or contributor prop. */
  readonly placement: ExtensionPlacement | undefined;
  readonly binding: ExtensionBinding | undefined;
} & ({ readonly surface: 'sidebar'; readonly onBack?: (() => void) | undefined; readonly root?: never } |
  { readonly surface?: 'detail-tab'; readonly root?: ExtensionRootV1 | undefined; readonly onBack?: never });
type Visit = { readonly authority: ExtensionAuthority; readonly demand: ExtensionDemand; readonly started: number; committed: boolean };
type Mount = { readonly visit: Visit; readonly Body?: ExtensionBody };
type State = { readonly mount: Mount | null };

// A view can use kit presentation, not the surrounding page's link handler. Even a copied href has no owner locator.
const isolatedLinks: LinkHandler = { hrefOf: () => '#', onOpen: () => { /* No page navigation from a Body. */ } };

/** No native root, request handle, lease or owner context enters the contributor's props. The broker remounts on disclosure loss. */
function RelatedBody({ authority, demand, root, Body }: {
  readonly authority: ExtensionAuthority; readonly demand: ExtensionDemand; readonly root: ExtensionRootV1 | undefined; readonly Body: ExtensionBody;
}) {
  const { related, revision } = useExtensionRelated(authority, demand, root);
  return <Body key={revision} input={demand.input} related={related} />;
}

/** React checks this snapshot again before a concurrent render commits. A queued parent update alone cannot fence that commit. */
function LiveBody({ demand, onCommit, body }: { readonly demand: ExtensionDemand; readonly onCommit: (demand: ExtensionDemand) => void; readonly body: ReactElement }) {
  const { signal } = demand;
  const subscribe = useCallback((notify: () => void) => {
    signal.addEventListener('abort', notify, { once: true });
    return () => {
      signal.removeEventListener('abort', notify);
    };
  }, [signal]);
  const isWithdrawn = useSyncExternalStore(subscribe, () => signal.aborted);
  useLayoutEffect(() => {
    onCommit(demand);
  }, [demand, onCommit]);
  // Keep kit presentation. Do not lend the peer the surrounding page's stores, session controls, routes or query cache.
  return isWithdrawn ? null : (
    <ExtensionAuthorityContext.Provider value={null}>
      <ExtensionMenuNavigationContext.Provider value={null}>
        <QueryClientContext.Provider value={undefined}>
          <TabsProvider store={null}>
            <PanelProvider panel={null}>
              <PaletteProvider palette={null}>
                <SettingsProvider settings={null}>
                  <NoticesProvider notices={null}>
                    <LinkProvider handler={isolatedLinks}>{body}</LinkProvider>
                  </NoticesProvider>
                </SettingsProvider>
              </PaletteProvider>
            </PanelProvider>
          </TabsProvider>
        </QueryClientContext.Provider>
      </ExtensionMenuNavigationContext.Provider>
    </ExtensionAuthorityContext.Provider>
  );
}

function Loading({ visit, onTimeout }: { readonly visit: Visit; readonly onTimeout?: (token: ExtensionDemand) => void }) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const { demand } = visit;
    // The native role read and the first suspended render share one deadline. A later suspension is a new local wait.
    const elapsed = visit.committed ? 0 : performance.now() - visit.started;
    const announce = setTimeout(() => {
      if (!demand.signal.aborted) {
        setMessage('Loading view…');
      }
    }, Math.max(0, 200 - elapsed));
    const slow = setTimeout(() => {
      if (!demand.signal.aborted) {
        setMessage('Still loading view…');
      }
    }, Math.max(0, 1000 - elapsed));
    const expire = onTimeout && setTimeout(() => {
      onTimeout(demand);
    }, Math.max(0, EXTENSION_DEADLINE_MS - elapsed));
    return () => {
      clearTimeout(announce);
      clearTimeout(slow);
      clearTimeout(expire);
    };
  }, [visit, onTimeout]);
  // Keep the live announcement outside the busy group: assistive technology may defer messages inside a busy subtree.
  return <><div role="group" aria-label="View content" aria-busy="true" /><span role="status">{message}</span></>;
}

/** Mounted only for the foreground tab, keyed by its visit, not by admission. Once withdrawn, only a fresh visit or Retry can run. */
export class ExtensionView extends Component<Props, State> {
  static contextType = ExtensionAuthorityContext;
  static getDerivedStateFromError(): State {
    // Do not inspect, stringify, report or retain a value thrown by peer code.
    return { mount: null };
  }

  declare context: ContextType<typeof ExtensionAuthorityContext>;
  state: State = { mount: null };
  private readonly region = createRef<HTMLElement>();
  private recoverFocus = false;
  private attempted = false;
  private hidden = document.hidden;
  private paused?: ExtensionBinding;
  private updatedView?: ExtensionDemand;
  private live?: Visit;

  componentDidCatch(): void {
    this.retire();
  }

  componentDidMount(): void {
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.start();
  }

  getSnapshotBeforeUpdate(): boolean {
    return this.region.current?.contains(document.activeElement) === true;
  }

  componentDidUpdate(_before: Props, _state: State, hadFocus: boolean): void {
    if ((hadFocus || this.recoverFocus) && !document.hidden && document.activeElement === document.body) {
      this.region.current?.focus({ preventScroll: true });
    }

    this.recoverFocus = false;
    if (this.live && !this.current(this.live.demand)) {
      this.withdraw();
    } else if (!this.attempted) {
      // Cold links can arrive before either the authoritative inventory or the owner's layout lease.
      this.start();
    }
  }

  componentWillUnmount(): void {
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.retire();
    this.attempted = false;
  }

  render(): ReactNode {
    if (document.hidden) {
      return null;
    }

    const { mount } = this.state;
    const live = mount && this.current(mount.visit.demand) ? mount.visit : null;
    const { onBack, binding, placement, root, surface } = this.props;
    const Body = mount?.Body;
    return (
      <section aria-label={live ? live.demand.binding.declaration.label : 'Extension view'} ref={this.region} tabIndex={-1}>
        {live && Body ? (
          <Suspense key={live.demand.generation} fallback={<Loading visit={live} onTimeout={this.expire} />}>
            <LiveBody demand={live.demand} onCommit={this.committed} body={live.demand.binding.declaration.kind === 'view' && live.demand.binding.declaration.requestRead
              ? <RelatedBody authority={live.authority} demand={live.demand} root={root} Body={Body} />
              : <Body input={live.demand.input} />} />
          </Suspense>
        ) : live ? <Loading visit={live} /> : (
          <Notice title="View unavailable" actions={<>
            {onBack && <Button size="compact" onClick={onBack}>Back</Button>}
            <Button size="compact" onClick={this.retry} disabledReason={!binding || !placement ? 'This view is not currently available.' : undefined}>Retry</Button>
          </>}>
            {`Choose another ${surface === 'sidebar' ? 'item in the sidebar' : 'detail tab'} or try again when this view is available.`}
          </Notice>
        )}
      </section>
    );
  }

  private readonly visibilityChanged = () => {
    const hidden = document.hidden;
    if (this.hidden === hidden) {
      return;
    }

    this.hidden = hidden;
    if (hidden) {
      this.paused = this.live?.demand.binding;
      if (this.paused) {
        this.attempted = false;
      }

      this.retire();
    } else {
      // Resume only an uninterrupted selection, never an already withdrawn mount or a replacement grant.
      if (this.paused && this.paused !== this.props.binding) {
        this.attempted = true;
      }

      this.paused = undefined;
    }

    this.setState({ mount: null });
  };

  private current(demand: ExtensionDemand): boolean {
    return !document.hidden && (this.props.surface ?? 'detail-tab') === demand.binding.placement &&
      this.props.binding === demand.binding && this.props.placement === demand.placement &&
      this.live?.demand === demand && this.context === this.live.authority && !demand.signal.aborted && this.live.authority.current(demand);
  }

  private retire(): void {
    const live = this.live;
    this.live = undefined;
    if (live) {
      live.demand.signal.removeEventListener('abort', this.withdraw);
      live.authority.endDemand(live.demand);
    }
  }

  private readonly withdraw = () => {
    // The external-store fence can remove the focused child before the parent's own fallback commit.
    this.recoverFocus ||= this.region.current?.contains(document.activeElement) === true;
    const prior = this.live?.demand;
    this.updatedView = prior?.binding.placement === 'detail-tab' && prior.signal.reason === EXTENSION_INPUT_CHANGED ? prior : undefined;
    this.retire();
    this.attempted = this.updatedView === undefined;
    this.setState({ mount: null });
  };

  private readonly expire = (demand: ExtensionDemand) => {
    if (this.current(demand)) {
      this.withdraw();
    }
  };

  private readonly retry = () => {
    this.retire();
    this.updatedView = undefined;
    this.attempted = false;
    this.start();
    if (!this.live) {
      this.setState({ mount: null });
    }
  };

  private readonly committed = (demand: ExtensionDemand) => {
    const visit = this.live;
    if (visit?.demand === demand && !demand.signal.aborted) {
      visit.committed = true;
      visit.authority.viewCommitted(demand);
    }
  };

  private start(): void {
    const { binding, placement } = this.props;
    const authority = this.context;
    if (this.attempted || document.hidden || !placement || !binding || !authority) {
      return;
    }

    this.attempted = true;
    const surface = this.props.surface ?? 'detail-tab';
    if (binding.placement !== surface || binding.declaration.kind !== 'view') {
      return;
    }

    const demand = authority.beginDemand(placement, binding, this.updatedView);
    this.updatedView = undefined;
    if (!demand) {
      return;
    }

    const visit = { authority, demand, started: performance.now(), committed: false };
    this.live = visit;
    demand.signal.addEventListener('abort', this.withdraw, { once: true });
    this.setState({ mount: { visit } });
    void loadExtensionBody(authority, demand, surface).then(Body => {
      if (this.current(demand)) {
        this.setState({ mount: { visit, Body } });
      }
    }, () => {
      if (this.current(demand)) {
        this.withdraw();
      }
    });
  }

}
