import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon, type IconName } from '../Icon';
import styles from './Tabs.module.css';

export type TabsItem = {
  readonly id: string;
  readonly label: string;
  /** A glyph before the label. */
  readonly icon?: IconName | undefined;
  /** A number after the label, muted: how many things the section holds. Zero is a value. */
  readonly count?: number | undefined;
};

export type TabsProps = {
  /** Names the strip: what the tabs are sections of ("Item sections"). */
  readonly label: string;
  readonly tabs: readonly TabsItem[];
  /** The id of the selected tab. */
  readonly selected: string;
  readonly onSelect: (id: string) => void;
  /** The base id the parts' ids derive from: the strip's tab is `<id>-tab-<tab id>`, the one panel it switches is `<id>-panel`. */
  readonly id: string;
} & DataAttributes;

const tabId = (base: string, id: string) => `${base}-tab-${id}`;
const panelId = (base: string) => `${base}-panel`;

/**
 * The in-page tabs of a detail page (design 14 P4): a strip of buttons that switches the sections of one object, as ONE tab stop
 * (the selected tab; the others are reached with the arrows). Left and Right move to the neighbour and wrap, Home and End go to the
 * ends, and a tab that gets the focus this way is selected (automatic activation). Enter and Space are the button's click. The strip
 * does not wrap: it scrolls sideways when the tabs do not fit. Pair it with a `TabPanel` of the same `id`. With no tabs it draws
 * nothing. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function Tabs({ label, tabs, selected, onSelect, id, ...rest }: TabsProps): ReactElement | null {
  const first = tabs[0];
  if (first === undefined) {
    return null;
  }

  // A selected id that names no tab leaves the strip without a stop; the first tab is it then.
  const stop = tabs.some((tab) => tab.id === selected) ? selected : first.id;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A key that something else took, a composition, and a chord are not the strip's.
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    const { key } = event;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') {
      return;
    }

    const faces = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const at = faces.indexOf(event.target as HTMLElement);
    if (at < 0) {
      return;
    }

    event.preventDefault();
    const last = faces.length - 1;
    const to = key === 'Home' ? 0 : key === 'End' ? last : key === 'ArrowLeft' ? (at + last) % faces.length : (at + 1) % faces.length;
    const face = faces[to];
    const tab = tabs[to];
    if (face === undefined || tab === undefined || to === at) {
      return;
    }

    face.focus({ preventScroll: true });
    face.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (tab.id !== selected) {
      onSelect(tab.id);
    }
  };

  return (
    <div {...dataAttributes(rest)} className={styles.root} role="tablist" aria-label={label} data-ov-part="tabs" onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const isSelected = tab.id === selected;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(id, tab.id)}
            className={styles.tab}
            aria-selected={isSelected}
            aria-controls={panelId(id)}
            tabIndex={tab.id === stop ? 0 : -1}
            data-ov-part="tab"
            data-ov-selected={isSelected ? 'true' : undefined}
            onClick={() => {
              if (!isSelected) {
                onSelect(tab.id);
              }
            }}
          >
            {tab.icon === undefined ? null : <Icon name={tab.icon} />}
            {tab.label}
            {tab.count === undefined ? null : (
              <span className={styles.count} data-ov-part="tab-count">
                {` ${tab.count}`}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export type TabPanelProps = {
  /** The same `id` the strip has: the panel is `<id>-panel`. */
  readonly id: string;
  /** The id of the selected tab: the panel is labelled by it. */
  readonly selected: string;
  readonly children?: ReactNode;
} & DataAttributes;

/**
 * The one panel a strip switches: a tabpanel named by the selected tab. The caller draws the selected section inside it. The panel is a tab stop of its own, after the strip's one: a panel
 * whose first content is not a control (text, a status line, a skeleton) could not be reached from the keyboard otherwise, and the tabs pattern asks for the stop in that case (WAI-ARIA
 * Authoring Practices, Tabs). A panel that starts with a control has one stop more than it needs, and that is the pattern's own example.
 */
export function TabPanel({ id, selected, children, ...rest }: TabPanelProps): ReactElement {
  return (
    <div {...dataAttributes(rest)} id={panelId(id)} className={styles.panel} role="tabpanel" aria-labelledby={tabId(id, selected)} tabIndex={0} data-ov-part="tab-panel">
      {children}
    </div>
  );
}
