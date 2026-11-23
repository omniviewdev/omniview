import { useSyncExternalStore } from 'react';
import { dispositionOf, platformOf, type ModifierEvent } from '../../shell';
import type { ConnectionsState } from './connections';
import { Home } from './Home';
import { homeGroupsOf } from './homeModel';
import { HOME_PAGE_ID, type HostPageDefinition, type HostPageProps } from './hostPages';
import { homeEntriesOf } from './NoTabs';

// Home as a page of the host (HM1; ch16 S8, S9, S34: "Home is an ordinary tab and several may exist"): the same content the empty window shows (decision A17), in a tab. A window with no connection API (`connections`
// absent) lists none and says nothing of them.

/** What a window with no connection API reads: nothing, ever. */
const NO_CONNECTIONS = {
  subscribe: (): (() => void) => () => undefined,
  getSnapshot: (): ConnectionsState => NONE,
};
const NONE: ConnectionsState = { loaded: true, failed: false, connections: [] };

const PLATFORM = platformOf(navigator);

function HomePage({ plugins, connections, openPlugin }: HostPageProps) {
  const entries = useSyncExternalStore(plugins.subscribe, plugins.getSnapshot);
  const source = connections?.store ?? NO_CONNECTIONS;
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const openConnection = (plugin: string, key: string, event: ModifierEvent | undefined): void => {
    void connections?.actions.go(plugin, key, { how: dispositionOf(event, { platform: PLATFORM }), source: 'home' });
  };

  return (
    <Home
      entries={homeEntriesOf(entries)}
      groups={homeGroupsOf(entries, state.connections)}
      connections={state.loaded ? (state.failed ? 'failed' : 'ready') : 'loading'}
      empty={false}
      onOpenPlugin={openPlugin}
      onOpenConnection={openConnection}
    />
  );
}

/** The Home page, registered with the window's host pages (`PluginHost.tsx`). */
export const homePage: HostPageDefinition = { id: HOME_PAGE_ID, title: 'Home', icon: 'house', singleton: false, layout: 'document', Page: HomePage };
