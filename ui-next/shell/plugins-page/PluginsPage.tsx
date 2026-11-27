import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { pageMemoryOf } from '../../plugins/host/pageMemory';
import type { EventSource } from '../../plugins/host/lifecycle';
import { HOST_PLUGIN, type HostPageDefinition, type HostPageProps } from '../../plugins/host/hostPages';
import { useNotices } from '../notices/context';
import { uninstallWords } from './core/words';
import { createPluginsModel, type PluginActions } from './core/model';
import type { InventoryEntry } from './core/types';
import { ConfirmUninstall } from './ConfirmUninstall';
import { Detail } from './Detail';
import { reportFailure } from './failureReport';
import { useList } from './hooks';
import { List } from './List';
import styles from './PluginsPage.module.css';

// The Plugins page as a host page in a tab (ch16 S9, S133): the installed plugins listed on the left, the plugin the person is reading on the right. The model (`core/model.ts`) is the page's state and listens to the host
// only while the page is on screen; this component makes it, hands each pane the slice it draws, and owns the one dialog the slice has, the confirm of an uninstall.

/** The id of the page in a route: `{ plugin: 'host', contribution: 'plugins' }`. */
export const PLUGINS_PAGE = 'plugins';

/** What the page reads of the host and asks of it. The real ones are `host.ts`; a test or a probe gives others. */
export type PluginsPageDeps = {
  /** The host's inventory (`PluginManager.ListPlugins`). */
  readonly read: () => Promise<readonly InventoryEntry[]>;
  readonly actions: PluginActions;
  /** The runtime's `Events`. */
  readonly events: EventSource;
  /** The inventory the window already holds, so the first frame has the list. */
  readonly seed?: ((queryClient: ReturnType<typeof useQueryClient>) => readonly InventoryEntry[] | undefined) | undefined;
};

function PluginsPageView({ tabs, tabId, plugins, onRetry, deps }: HostPageProps & { readonly deps: PluginsPageDeps }) {
  const queryClient = useQueryClient();
  const { store } = useNotices();
  const [model] = useState(() =>
    createPluginsModel({
      read: deps.read,
      seed: deps.seed === undefined ? undefined : () => deps.seed?.(queryClient),
      entries: plugins,
      events: deps.events,
      actions: deps.actions,
      retry: onRetry,
      fail: (failure) => {
        reportFailure(store, failure);
      },
      memory: pageMemoryOf(tabs, tabId),
    }),
  );
  useEffect(() => model.attach(), [model]);
  // The window's Retry is a new function whenever the window's list of plugins changes: the model is made once, and is handed the one that is current.
  useEffect(() => {
    model.setRetry(onRetry);
  }, [model, onRetry]);

  const { selected } = useList(model);
  const [confirming, setConfirming] = useState<string | null>(null);
  const target = confirming === null ? undefined : model.row(confirming);

  return (
    <div className={styles.page} data-pl-page="">
      <List model={model} />
      <Detail
        model={model}
        id={selected}
        onUninstall={(id) => {
          setConfirming(id);
        }}
      />
      {target === undefined ? null : (
        <ConfirmUninstall
          words={uninstallWords(
            target.plugin.name,
            target.plugin.devMode,
            Object.values(tabs.getSnapshot().tabs).filter((tab) => tab.location.route.plugin === target.id).length,
          )}
          version={target.plugin.version}
          onConfirm={() => {
            setConfirming(null);
            model.uninstall(target.id);
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}

/** The Plugins page over `deps`: the host page the window registers (`registerHostPage`). */
export function createPluginsPage(deps: PluginsPageDeps): HostPageDefinition {
  return {
    id: PLUGINS_PAGE,
    title: 'Plugins',
    icon: 'puzzle',
    layout: 'split',
    Page: (props) => <PluginsPageView {...props} deps={deps} />,
  };
}

/** The route of the page. */
export const PLUGINS_ROUTE = { plugin: HOST_PLUGIN, contribution: PLUGINS_PAGE } as const;
