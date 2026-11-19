import { Icon, Text, isIconName } from '@omniviewdev/kit';
import type { ToolId } from '../core/panel';
import { useTablist } from '../tablist';
import { usePanel } from './context';
import { useActiveTool, useToolIds, useToolItem } from './hooks';
import styles from './Header.module.css';
import { toolTabId } from './words';

/** A plugin's glyph name is data from outside: a name the kit does not have draws the generic one rather than throwing in the strip. */
const FALLBACK_GLYPH = 'box';

type ToolTabProps = {
  readonly id: ToolId;
  /** The strip's one tab stop (a roving tabindex). */
  readonly stop: boolean;
  readonly selected: boolean;
  /** The id of the region the tab switches, and the shell's id prefix for the tabs' DOM ids. */
  readonly controls: string;
  readonly prefix: string;
};

/**
 * One tool tab: a 28 px capsule with the tool's glyph and its words (ch16 S113), the selected one filled like a document tab. It reads its own tool's item and renders when that changes:
 * a session changing state does not touch it. Activation is explicit: arrows move the focus, Enter and Space (the button's own click) select the tool, because switching a tool switches a
 * body that may be heavy.
 */
function ToolTab({ id, stop, selected, controls, prefix }: ToolTabProps) {
  const { store } = usePanel();
  const item = useToolItem(id);
  if (item === undefined) {
    return null;
  }

  return (
    <button
      type="button"
      role="tab"
      id={toolTabId(prefix, id)}
      className={styles.toolTab}
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={stop ? 0 : -1}
      data-tab-id={id}
      data-shell-focus={stop ? '' : undefined}
      onClick={() => {
        store.activateTool(id);
      }}
    >
      <Icon name={isIconName(item.icon) ? item.icon : FALLBACK_GLYPH} />
      <span className={styles.toolLabel} dir="auto">
        <Text>{item.label}</Text>
      </span>
    </button>
  );
}

/** The tool tabs of the panel's header, "Panel tools" (S113): one tab stop, the keyboard contract of every strip of the shell (`useTablist`). */
export function ToolTabs({ prefix, controls }: { readonly prefix: string; readonly controls: string }) {
  const ids = useToolIds();
  const active = useActiveTool();
  const { ref, stop, handlers } = useTablist({ ids, selected: active });
  if (ids.length === 0) {
    return null;
  }

  return (
    <div ref={ref} className={styles.toolTabs} role="tablist" aria-label="Panel tools" data-shell-part="panelTools" {...handlers}>
      {ids.map((id) => (
        <ToolTab key={id} id={id} stop={id === stop} selected={id === active} controls={controls} prefix={prefix} />
      ))}
    </div>
  );
}
