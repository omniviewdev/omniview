import { Icon, IconButton, Text, hoverCard, hoverCardAnchor, isIconName, tip, type IconName } from '@omniviewdev/kit';
import type { SessionId, SessionState, ToolId } from '../core/panel';
import { useTablist } from '../tablist';
import { usePanel } from './context';
import { focusTab } from './focus';
import { useActiveSession, useSessionIds, useSessionItem, useToolItem } from './hooks';
import styles from './Header.module.css';
import { sessionName, sessionTabId } from './words';

/** What the lead slot draws while a session is not steady (ch16 S116): the loader while it starts, an info mark when it ended, the error mark when it failed. A running session shows its tool's glyph. */
const STATE_GLYPHS: Readonly<Record<Exclude<SessionState, 'running'>, IconName>> = { starting: 'loader', ended: 'status-info', failed: 'status-error' };

const FALLBACK_GLYPH = 'box';

type SessionTabProps = {
  readonly id: SessionId;
  readonly stop: boolean;
  readonly selected: boolean;
  readonly controls: string;
  readonly prefix: string;
};

/**
 * One session tab (ch16 S113, SCT1): the anatomy of a document tab. ONE 16 px lead slot (the tool's glyph, or the session's state while it is not steady), 4 px, the name as a head that
 * gives way with an end ellipsis and a tail that keeps its end (a generated suffix, an ordinal), then the muted scope, which gives way first; CSS cuts it, nothing is measured. The
 * accessible name is the whole name and the state; the card (hover and keyboard focus, SCD1) takes the place of a plain-text tooltip. The close control is the pointer's, as the document
 * tab's is: a tablist owns tabs and nothing else, so it is hidden from the accessibility tree and out of the tab order, and the keyboard closes a session with Delete.
 */
function SessionTab({ id, stop, selected, controls, prefix }: SessionTabProps) {
  const { store } = usePanel();
  const item = useSessionItem(id);
  const tool = useToolItem(item?.tool ?? '');
  if (item === undefined) {
    return null;
  }

  const stateGlyph = item.state === 'running' ? undefined : STATE_GLYPHS[item.state];
  const toolGlyph = tool !== undefined && isIconName(tool.icon) ? tool.icon : FALLBACK_GLYPH;
  return (
    <div className={styles.sessionItem} data-tab-id={id} data-selected={selected ? '' : undefined} data-shell-part="sessionTab" {...hoverCardAnchor()}>
      <button
        type="button"
        role="tab"
        id={sessionTabId(prefix, id)}
        className={styles.sessionTab}
        aria-selected={selected}
        aria-controls={controls}
        aria-keyshortcuts="Delete"
        aria-label={sessionName(item)}
        tabIndex={stop ? 0 : -1}
        data-tab-id={id}
        {...hoverCard(id, { arrow: 'down' })}
        onClick={() => {
          store.activateSession(id);
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            store.closeSession(id);
          }
        }}
        onMouseDown={(event) => {
          // The middle button would start the browser's autoscroll before it closes the session.
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
      >
        <span className={styles.lead} data-shell-part="sessionLead" data-state={item.state === 'running' ? undefined : item.state}>
          <Icon name={stateGlyph ?? toolGlyph} />
        </span>
        <span className={styles.sessionLabel} data-shell-part="sessionLabel" dir="auto">
          <span className={styles.sessionTitle}>
            <span className={styles.sessionHead} data-shell-part="sessionHead">
              <Text>{item.head}</Text>
            </span>
            {item.tail === '' ? null : (
              <span className={styles.sessionTail} data-shell-part="sessionTail">
                <Text>{item.tail}</Text>
              </span>
            )}
          </span>
          {item.scope === '' ? null : (
            <span className={styles.sessionScope} data-shell-part="sessionScope">
              <Text variant="caption" tone="muted">
                {item.scope}
              </Text>
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        className={styles.sessionClose}
        data-shell-part="sessionClose"
        tabIndex={-1}
        aria-hidden="true"
        {...tip(`Close ${item.name}`)}
        onClick={() => {
          store.closeSession(id);
        }}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

type SessionTabsProps = {
  readonly tool: ToolId;
  readonly prefix: string;
  /** The id of the region the tabs switch. */
  readonly controls: string;
};

/**
 * The session tabs of the tool on screen, "<Tool> sessions" (S113): a scroller of faces, one tab stop, the keyboard contract of every strip of the shell (`useTablist`), Delete closes the
 * session and hands the focus to its neighbour; the last session has none, and the focus goes to the tool's own tab (as the close chord does, `usePanelChords`) and not to the document, the
 * tab that had it being gone. It scrolls sideways only and keeps each tab's width: a strip squeezed to a minimum width is illegible (SCT1).
 */
export function SessionTabs({ tool, prefix, controls }: SessionTabsProps) {
  const { store } = usePanel();
  const label = useToolItem(tool)?.label ?? 'Tool';
  const ids = useSessionIds(tool);
  const active = useActiveSession(tool);
  const { ref, stop, handlers } = useTablist({
    ids,
    selected: active,
    onClose: (id) => {
      const closed = store.closeSession(id);
      if (closed.status === 'done' && closed.active === null) {
        focusTab('panelTools', tool);
      }

      return closed.status === 'done';
    },
  });
  if (ids.length === 0) {
    return null;
  }

  return (
    <div ref={ref} className={styles.sessionList} role="tablist" aria-label={`${label} sessions`} data-shell-part="sessionTabs" {...handlers}>
      {ids.map((id) => (
        <SessionTab key={id} id={id} stop={id === stop} selected={id === active} controls={controls} prefix={prefix} />
      ))}
    </div>
  );
}

/** The `+` of a tool that can start a session: a ghost icon button, last in the strip. The mock's `▾` beside it opens a menu of targets, which is not built (docs/ui-next/status/P1a.md). */
export function NewSession({ label, onStart }: { readonly label: string; readonly onStart: () => void }) {
  return (
    <div className={styles.add} data-shell-part="sessionAdd">
      <IconButton icon="plus" label={label} variant="ghost" onClick={onStart} {...tip(label)} />
    </div>
  );
}
