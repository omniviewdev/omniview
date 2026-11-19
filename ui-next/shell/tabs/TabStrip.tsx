import { Icon, tip } from '@omniviewdev/kit';
import { useTablist } from '../tablist';
import { useTabs } from './context';
import { useActiveId, useTabIds } from './hooks';
import { Tab } from './Tab';
import styles from './TabStrip.module.css';

type TabStripProps = {
  readonly prefix: string;
  readonly panelId: string;
  /** What the new-tab control does. Absent: the strip has none. The mock's control opens a menu (ch16 S34); until the menu exists the host answers it with a plain new tab. */
  readonly onNewTab: (() => void) | undefined;
};

/**
 * The strip of the top row (ch16 S4, S53, S54): the tabs in one scroller, then the new-tab control. The faces share the strip's width equally, 208 px at most, and give way together
 * down to 96 px before the scroller scrolls; the wheel scrolls it sideways and the tab on screen is always brought into view. It is a roving tablist with one tab stop: the arrows
 * move the focus and never load a page, Home and End jump, Enter and Space select, Delete closes and puts the focus on the neighbour (`useTablist`, the contract every strip of the shell
 * shares). It reads the order and the tab on screen and nothing else: each `Tab` reads its own slice, so a change in one tab does not render the strip. Kit part it should become: TabStrip.
 */
export function TabStrip({ prefix, panelId, onNewTab }: TabStripProps) {
  const store = useTabs();
  const ids = useTabIds(store);
  const active = useActiveId(store);
  const { ref, stop, handlers } = useTablist({ ids, selected: active, onClose: (id) => store.close(id).status === 'done' });

  return (
    <div className={styles.strip} data-shell-part="tabStrip">
      <div ref={ref} className={styles.scroller} role={ids.length === 0 ? undefined : 'tablist'} aria-label={ids.length === 0 ? undefined : 'Open tabs'} {...handlers}>
        {ids.map((id) => (
          <Tab key={id} id={id} stop={id === stop} active={id === active} prefix={prefix} panelId={panelId} />
        ))}
      </div>
      {onNewTab === undefined ? null : (
        <button type="button" className={styles.new} aria-label="New tab" {...tip('New tab')} onClick={onNewTab}>
          <Icon name="plus" />
        </button>
      )}
    </div>
  );
}
