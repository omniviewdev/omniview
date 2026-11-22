import type { IconName } from '@omniviewdev/kit';
import type { ReactNode } from 'react';
import type { Route, TabId, TabsStore } from '../../shell';
import type { PluginSource } from './contributions';

// The pages the HOST itself offers, as tabs: the Plugins page today (ch16 S9: Settings, Plugins and Developer Tools are app-wide singleton tabs, rendered by the host through the same contract as any plugin, the plugin id `host`).
// A host page is registered with one call (`registerHostPage`), and the places that ask what a route is (the tab model's `describe` and `availability`, the page host that draws it, the palette's command that opens it) read the
// registry. The window's rail has no entry for a host page and the New tab menu is not built (docs/ui-next/status/PL1.md): the palette's command is how one is opened.

/** The plugin id every host page's route carries. */
export const HOST_PLUGIN = 'host';

/** What the window gives a host page when it draws it in a tab. */
export type HostPageProps = {
  readonly tabs: TabsStore;
  /** The tab the page is drawn in: where it keeps what the person chose (`pageMemoryOf`). */
  readonly tabId: TabId;
  /** The window's plugin store: what each plugin's interface came to (the entries the rail reads). */
  readonly plugins: PluginSource;
  /** The window's Retry for a plugin that is not there. */
  readonly onRetry: (id: string) => void;
};

export type HostPageDefinition = {
  /** The page's id in a route (`{ plugin: 'host', contribution: id }`). */
  readonly id: string;
  /** What the tab and the palette call it. */
  readonly title: string;
  readonly icon: IconName;
  /** The page, drawn in the tab. */
  readonly Page: (props: HostPageProps) => ReactNode;
};

const pages = new Map<string, HostPageDefinition>();

/** Registers a host page, replacing the one with its id. */
export function registerHostPage(page: HostPageDefinition): void {
  pages.set(page.id, page);
}

/** The host page a route names; `undefined` for a route of a plugin, and for a host route no page is registered for. */
export function hostPageOf(route: Route): HostPageDefinition | undefined {
  return route.plugin === HOST_PLUGIN ? pages.get(route.contribution) : undefined;
}

/** Every registered host page, in the order they were registered. */
export const allHostPages = (): readonly HostPageDefinition[] => [...pages.values()];
