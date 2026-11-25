import { Icon, Text, isIconName, tip } from '@omniviewdev/kit';
import { splitTitle } from '../core/title';
import type { TabId } from '../core/tabs';
import { useTabs } from './context';
import { useStripItem } from './hooks';
import styles from './TabStrip.module.css';
import { tabDomId, tabName, tabTip } from './words';

type TabProps = {
  readonly id: TabId;
  /** The strip's one tab stop (a roving tabindex): the tab the focus is on, else the tab on screen. */
  readonly stop: boolean;
  /** The tab on screen. */
  readonly active: boolean;
  /** The shell's id prefix for the tabs' DOM ids, and the id of the one page region every tab controls. */
  readonly prefix: string;
  readonly panelId: string;
};

/** A plugin's glyph name is data from outside: a name the kit does not have draws the generic one rather than throwing in the strip. */
const FALLBACK_GLYPH = 'box';

/**
 * One tab of the strip: a face (28 px, equal width with its neighbours), the page's glyph, its title cut in the middle when it does not fit, the qualifier that tells it from a twin,
 * and a close control that is always there (ch16 S17, S17b). It subscribes to its own slice of the model and renders when that changes: a title changing in another tab does not
 * touch this one. The tab is one tab stop of the strip's roving tablist. The close control is the pointer's: a tablist owns tabs and nothing else (axe: aria-required-children, a button
 * among them is "not allowed"), so the control is hidden from the accessibility tree and out of the tab order, and the keyboard and assistive technology close a tab the ways the tab itself
 * offers: Delete or Backspace on the focused tab (S54), the close chord, and the tab's context menu when it exists (S55). Kit part it should become: Tab, in TabStrip.
 */
export function Tab({ id, stop, active, prefix, panelId }: TabProps) {
  const store = useTabs();
  const item = useStripItem(store, id);
  if (item === undefined) {
    return null;
  }

  const { identity } = item;
  const [head, tail] = splitTitle(identity.title);
  const glyph = isIconName(item.icon) ? item.icon : FALLBACK_GLYPH;
  const closeLabel = `Close ${identity.title}`;
  return (
    <div
      className={styles.item}
      data-shell-part="tab"
      data-tab-id={id}
      data-active={active ? '' : undefined}
      data-pinned={item.pinned ? '' : undefined}
      data-preview={item.preview ? '' : undefined}
    >
      <button
        type="button"
        role="tab"
        id={tabDomId(prefix, id)}
        className={styles.tab}
        aria-selected={active}
        aria-controls={panelId}
        aria-keyshortcuts="Delete"
        aria-label={tabName(item)}
        tabIndex={stop ? 0 : -1}
        data-tab-id={id}
        data-shell-focus={stop ? '' : undefined}
        {...tip(tabTip(item))}
        onPointerDown={(event) => {
          // A mouse or a pen selects on the press, as a browser's tabs do; a touch selects on the click, so a swipe still scrolls the strip.
          if (event.button === 0 && event.pointerType !== 'touch') {
            store.activate(id);
          }
        }}
        onClick={() => {
          store.activate(id);
        }}
        onDoubleClick={() => {
          store.keep(id);
        }}
        onMouseDown={(event) => {
          // The middle button would start the browser's autoscroll before it closes the tab.
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            store.close(id);
          }
        }}
      >
        <span className={styles.lead}>
          <Icon name={glyph} />
        </span>
        {item.pinned || item.preview ? (
          <span className={styles.mark}>
            <Icon name={item.pinned ? 'pin' : 'eye'} />
          </span>
        ) : null}
        <span className={styles.content}>
          <span className={styles.title} dir="auto">
            <span className={styles.head}>
              <Text>{head}</Text>
            </span>
            {tail === '' ? null : (
              <span className={styles.tail}>
                <span>
                  <Text>{tail}</Text>
                </span>
              </span>
            )}
          </span>
          {identity.qualifier === '' ? null : (
            <span className={styles.qualifier} dir="auto">
              <Text variant="caption" tone="muted">{identity.qualifier}</Text>
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        className={styles.close}
        tabIndex={-1}
        aria-hidden="true"
        {...tip(closeLabel)}
        onClick={() => {
          store.close(id);
        }}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
