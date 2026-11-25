import type { IconName } from '@omniviewdev/kit';
import type { Platform } from '../core/chords';
import { closeSet, type CloseResult, type CloseScope, type TabId, type TabResult, type TabsStore } from '../core/tabs';
import { tabChordText } from './words';

// The commands of one tab, defined once: the tab's context menu (S55) and the palette list the same rows, with the same words, reasons and chord. Every row runs the tab model's own operation;
// the reasons are the mock's (`shell-tabs.js` `menuItems`), and a reason is only said when the model would do nothing.

type Answer = CloseResult | TabResult | { readonly status: 'done' };

export type TabCommand = {
  readonly title: string;
  readonly icon: IconName;
  /** The chord the shell binds to it, written for the platform. Absent: none is bound. */
  readonly shortcut?: string;
  /** Why it cannot run now. Absent: it can. */
  readonly unavailable?: string;
  /** What it runs on: the row picked from `choices`, when it has them. */
  readonly run: (choice?: string) => Answer;
  /** The rows of a command that picks one (the window to move to): it is a submenu. */
  readonly choices?: ReadonlyArray<{ readonly id: string; readonly title: string }>;
};

type Deps = {
  readonly tabs: TabsStore;
  readonly platform: Platform;
  /** The app's own window, where Command W is the shell's; a browser tab keeps that for itself. */
  readonly native: boolean;
  /** Opens a new tab right of the one named. Absent: the window has no new-tab control. */
  readonly onNewTab?: ((after?: TabId) => void) | undefined;
};

const NO_TAB = 'There is no tab';

/** The words of the four ways to close many (S42): the title, and the reason when nothing is left to close because there is no such tab, or because every such tab is pinned. */
const CLOSING = {
  others: { title: 'Close other tabs', bare: 'There are no other tabs', pinned: 'The other tabs are pinned' },
  right: { title: 'Close tabs to the right', bare: 'There are no tabs to the right', pinned: 'The tabs to the right are pinned' },
  left: { title: 'Close tabs to the left', bare: 'There are no tabs to the left', pinned: 'The tabs to the left are pinned' },
  unpinned: { title: 'Close all but pinned', bare: 'There are no unpinned tabs', pinned: 'There are no unpinned tabs' },
} as const;

/** The windows' rows: only an app with more than one window has them. */
export const WINDOW_GROUP = ['move-new', 'move-to'] as const;

/** The menu's groups, in the mock's order (S55); there is no split view. */
export const TAB_MENU_GROUPS = [
  ['new-right', 'duplicate', 'pin', 'reload'],
  WINDOW_GROUP,
  ['close', 'close-others', 'close-right', 'close-left', 'close-unpinned'],
  ['reopen'],
] as const;

/** What the palette lists, in order: the same rows, and the two that move the focus between tabs. */
export const TAB_PALETTE_COMMANDS = ['close', 'close-others', 'close-right', 'close-left', 'close-unpinned', 'duplicate', 'pin', 'reload', 'reopen', 'next', 'previous'] as const;

export type TabCommandId = 'new-right' | 'duplicate' | 'pin' | 'reload' | 'close' | 'close-others' | 'close-right' | 'close-left' | 'close-unpinned' | 'move-new' | 'move-to' | 'reopen' | 'next' | 'previous';

/** The commands of the tab `id` (the menu's tab, or the one on screen for the palette), made from what is true now. */
export function tabCommands({ tabs, platform, native, onNewTab }: Deps, id: TabId | null): Record<TabCommandId, TabCommand> {
  const state = tabs.getSnapshot();
  const tab = id === null ? undefined : state.tabs[id];
  const at = id === null ? -1 : state.order.indexOf(id);
  const none = tab === undefined ? NO_TAB : undefined;
  const nothingBetween = { others: state.order.length === 1, right: at === state.order.length - 1, left: at === 0, unpinned: true };
  const closing = (scope: CloseScope): TabCommand => ({
    title: CLOSING[scope].title,
    icon: 'close',
    unavailable: tab === undefined ? NO_TAB : closeSet(state, scope, tab.id).length > 0 ? undefined : CLOSING[scope][nothingBetween[scope] ? 'bare' : 'pinned'],
    run: () => tabs.closeMany(scope, id ?? undefined),
  });
  const reopen = tabs.canReopen();
  const others = state.order.length > 1 ? undefined : 'There is no other tab.';
  const { windows } = tabs;
  const elsewhere = windows?.others() ?? [];
  return {
    'new-right': {
      title: 'New tab to the right',
      icon: 'plus',
      unavailable: none ?? (onNewTab === undefined ? 'This window has no new tab' : undefined),
      run: () => {
        onNewTab?.(id ?? undefined);
        return { status: 'done' };
      },
    },
    duplicate: { title: 'Duplicate tab', icon: 'copy', unavailable: none ?? (tab?.face.singleton ? `Only one ${tab.face.title} tab can exist` : undefined), run: () => tabs.duplicate(id ?? undefined) },
    pin: { title: tab?.flags.pinned ? 'Unpin tab' : 'Pin tab', icon: 'pin', unavailable: none, run: () => tabs.pin(id ?? undefined) },
    reload: { title: 'Reload tab', icon: 'refresh', unavailable: none, run: () => tabs.reload(id ?? undefined) },
    close: { title: 'Close tab', icon: 'close', shortcut: tabChordText('close', platform, native), unavailable: none, run: () => tabs.close(id ?? undefined) },
    'close-others': closing('others'),
    'close-right': closing('right'),
    'close-left': closing('left'),
    'close-unpinned': closing('unpinned'),
    'move-new': { title: 'Move to new window', icon: 'external-link', unavailable: none, run: () => (windows === undefined || tab === undefined ? { status: 'noop' } : windows.moveToNew(tab.id)) },
    'move-to': {
      title: 'Move to window',
      icon: 'external-link',
      unavailable: none ?? (elsewhere.length === 0 ? 'There is no other window' : undefined),
      choices: elsewhere.map(({ name, label }) => ({ id: name, title: label })),
      run: (name) => (windows === undefined || tab === undefined || name === undefined ? { status: 'noop' } : windows.moveTo(name, tab.id)),
    },
    reopen: { title: 'Reopen closed tab', icon: 'undo', shortcut: tabChordText('reopen', platform, native), unavailable: reopen.ok ? undefined : reopen.message, run: () => tabs.reopen() },
    next: { title: 'Next tab', icon: 'arrow-right', shortcut: tabChordText('next', platform, native), unavailable: others, run: () => tabs.next() },
    previous: { title: 'Previous tab', icon: 'arrow-left', shortcut: tabChordText('previous', platform, native), unavailable: others, run: () => tabs.previous() },
  };
}
