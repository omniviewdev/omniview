import type { LinkHandler, LinkTarget } from '@omniviewdev/kit';
import { dispositionOf, type TabsStore } from '../../shell';
import { addressOf } from './route';

// What a link inside a plugin's page does (the kit's `Link`, which asks its `LinkProvider`): the address it shows, and where it opens. A link names a page of the plugin it is in and that page's
// parameters; the connection the page is read in goes with it unless the link names another, so an object opens in the connection of the page that links to it. The tab model decides where
// it lands (design 16 S26, S64): a plain click or Enter is smart (a tab that shows the destination is shown, else this tab goes there, else a new one), Command or Control, or a middle click,
// opens a background tab, Command and Shift together a new tab, Alt here, Shift a window (which the model has none of, and says so).

export type LinkHost = {
  readonly tabs: TabsStore;
  /** Which key opens in the background: Command on a Mac, Control elsewhere (`platformOf`). */
  readonly platform: 'mac' | 'other';
  /** The plugin the page is in. */
  readonly plugin: string;
  /** The connection the page is read in, when it has one. */
  readonly connection: string | undefined;
};

/** The parameters a target opens with: the page's connection first, and the target's own after it, so a target can name another connection. */
export const paramsOfTarget = (target: LinkTarget, connection: string | undefined): Readonly<Record<string, string>> => ({
  ...(connection === undefined ? {} : { connection }),
  ...target.params,
});

/** The handler a page's links are given. It holds the page's plugin and connection, not the tab model's state, so it changes only when the page moves. */
export function createLinkHandler({ tabs, platform, plugin, connection }: LinkHost): LinkHandler {
  return {
    hrefOf: (target) => addressOf({ plugin, page: target.page, params: paramsOfTarget(target, connection) }),
    onOpen: (target, activation) => {
      // The model's answer is not the link's to report: a refusal (the plugin cannot serve it) or a window (there is none) changes nothing, and the page stays where it is.
      tabs.open({ route: { plugin, contribution: target.page, params: paramsOfTarget(target, connection) } }, { how: dispositionOf(activation, { platform }), source: 'link' });
    },
  };
}
