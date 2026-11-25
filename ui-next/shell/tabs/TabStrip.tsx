import { Icon, tip, useMenu, type MenuItem } from '@omniviewdev/kit';
import { useEffect } from 'react';
import { platformOf } from '../core/chords';
import { isNativeWindow } from '../core/native';
import type { TabId } from '../core/tabs';
import { useMaybeNotices } from '../notices/context';
import { stripReceiver } from '../stripDrag';
import { useTablist } from '../tablist';
import { tabCommands, TAB_MENU_GROUPS, WINDOW_GROUP } from './commands';
import { useTabs } from './context';
import { useActiveId, useTabIds } from './hooks';
import { Tab } from './Tab';
import styles from './TabStrip.module.css';

type TabStripProps = {
  readonly prefix: string;
  readonly panelId: string;
  /** What the new-tab control does, and New tab to the right of a tab's menu (the tab it is right of). Absent: the strip has neither. The mock's control opens a menu (ch16 S34); until the menu exists the host answers it with a plain new tab. */
  readonly onNewTab: ((after?: TabId) => void) | undefined;
};

/**
 * The strip of the top row (ch16 S4, S53, S54): the tabs in one scroller, then the new-tab control. The faces share the strip's width equally, 208 px at most, and give way together
 * down to 96 px before the scroller scrolls; the wheel scrolls it sideways and the tab on screen is always brought into view. It is a roving tablist with one tab stop: the arrows
 * move the focus and never load a page, Home and End jump, Enter and Space select, Delete closes and puts the focus on the neighbour, Alt+Shift with those keys moves the tab (`useTablist`, the contract every strip of the shell
 * shares). A tab's context menu (S55) is one menu for the strip, resolved for the tab it opens on, and its rows are `commands.ts`'s, the palette's too. It reads the order and the tab on screen and nothing else: each `Tab` reads its own slice, so a change in one tab does not render the strip. Kit part it should become: TabStrip.
 */
export function TabStrip({ prefix, panelId, onNewTab }: TabStripProps) {
  const store = useTabs();
  const ids = useTabIds(store);
  const active = useActiveId(store);
  const say = useMaybeNotices()?.announcer.polite.announce;
  // The model's own reorder decides where the tab lands and whether it crosses the pinned boundary; a drop beside the separator of the pinned tabs says which side it is on. The strip says where the tab went (ch16 S45).
  const onMove = (id: TabId, to: number, pinned?: boolean): boolean => {
    const before = store.getSnapshot().tabs[id];
    if (before === undefined || store.reorder(id, to, { pinned }).status !== 'done') {
      return false;
    }

    const { order, tabs } = store.getSnapshot();
    const { face, flags } = tabs[id] ?? before;
    say?.(`${face.title} moved to position ${String(order.indexOf(id) + 1)} of ${String(order.length)}${flags.pinned === before.flags.pinned ? '' : flags.pinned ? ', pinned' : ', unpinned'}`);
    return true;
  };

  // Where the app has windows, a tab the pointer takes out of the strip goes over them: it joins the strip it is released on, or opens a window of its own under the pointer (S58); and this strip is where a tab from another window lands. A browser tab has one
  // window, and there the drag puts the tab back.
  const { windows } = store;
  const { ref, stop, focus, handlers } = useTablist({ ids, selected: active, onClose: (id) => store.close(id).status === 'done', onMove, onDragOut: windows?.dragOut });
  useEffect(() => {
    const strip = ref.current;
    return strip === null ? undefined : windows?.receive(stripReceiver(strip));
  }, [windows, ref]);

  // The menu gives the focus back to the tab it opened on before a row runs, and a close takes that tab away: the focus goes to the tab the model shows next, never to the page's body.
  const menu = useMenu((key) => {
    if (key === undefined || store.getSnapshot().tabs[key] === undefined) {
      return null;
    }

    const commands = tabCommands({ tabs: store, platform: platformOf(navigator), native: isNativeWindow(), onNewTab }, key);
    const groups = store.windows === undefined ? TAB_MENU_GROUPS.filter((group) => group !== WINDOW_GROUP) : TAB_MENU_GROUPS;
    return groups.flatMap((group, at): MenuItem[] => [
      ...(at === 0 ? [] : [{ kind: 'separator' as const, id: `group-${String(at)}` }]),
      ...group.map((id): MenuItem => {
        const { title, shortcut, unavailable, choices } = commands[id];
        const select = (choice?: string) => () => {
          const answer = commands[id].run(choice);
          if (answer.status === 'done' && 'active' in answer && answer.active !== null) {
            focus(answer.active);
          }
        };

        return choices === undefined
          ? { kind: 'action', id, label: title, shortcut, disabled: unavailable ?? false, onSelect: select() }
          : { kind: 'submenu', id, label: title, disabled: unavailable ?? false, items: choices.map((choice) => ({ kind: 'action', id: choice.id, label: choice.title, onSelect: select(choice.id) })) };
      }),
    ]);
  }, ids);

  return (
    <div className={styles.strip} data-shell-part="tabStrip">
      <div ref={ref} className={styles.scroller} role={ids.length === 0 ? undefined : 'tablist'} aria-label={ids.length === 0 ? undefined : 'Open tabs'} {...handlers}>
        {ids.map((id) => (
          <Tab key={id} id={id} stop={id === stop} active={id === active} prefix={prefix} panelId={panelId} menu={menu} />
        ))}
      </div>
      {onNewTab === undefined ? null : (
        <button type="button" className={styles.new} aria-label="New tab" {...tip('New tab')} onClick={() => {
          onNewTab();
        }}>
          <Icon name="plus" />
        </button>
      )}
    </div>
  );
}
