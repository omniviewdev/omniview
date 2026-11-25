import { Icon, IconButton, Text, hoverCard, hoverCardAnchor, isIconName, menuTrigger, tip, useMenu, type IconName, type MenuItem } from '@omniviewdev/kit';
import { useState } from 'react';
import { platformOf } from '../core/chords';
import type { SessionId, SessionState, ToolId } from '../core/panel';
import { useMaybeNotices } from '../notices/context';
import { useTablist } from '../tablist';
import { usePanel } from './context';
import { focusTab } from './focus';
import { useActiveSession, useSessionIds, useSessionItem, useToolItem } from './hooks';
import styles from './Header.module.css';
import { SessionRename } from './SessionRename';
import { closeChordText, sessionName, sessionTabId } from './words';

/** What the lead slot draws while a session is not steady (ch16 S116): the loader while it starts, an info mark when it ended, the error mark when it failed. A running session shows its tool's glyph. */
const STATE_GLYPHS: Readonly<Record<Exclude<SessionState, 'running'>, IconName>> = { starting: 'loader', ended: 'status-info', failed: 'status-error' };

const FALLBACK_GLYPH = 'box';

type SessionTabProps = {
  readonly id: SessionId;
  readonly stop: boolean;
  readonly selected: boolean;
  readonly controls: string;
  readonly prefix: string;
  /** The id of the strip's menu, which the tab is a context trigger of. */
  readonly menu: string;
  /** The name is being edited: the tab draws the field in place of its button. */
  readonly renaming: boolean;
  readonly onRenamed: (id: SessionId, title: string | null, refocus: boolean) => void;
};

/**
 * One session tab (ch16 S113, SCT1): the anatomy of a document tab. ONE 16 px lead slot (the tool's glyph, or the session's state while it is not steady), 4 px, the name as a head that
 * gives way with an end ellipsis and a tail that keeps its end (a generated suffix, an ordinal), then the muted scope, which gives way first; CSS cuts it, nothing is measured. The scope is drawn only to
 * tell twins apart (TI1: two sessions of one title and another scope, the model's `SessionItem.scope`); a tab with no twin draws none. The accessible name is the words the tab draws and the state, so it
 * holds the visible text (WCAG 2.5.3, axe's `label-content-name-mismatch`): the name and the scope are two parts the layout sets 4 px apart, and the DOM keeps them apart with a space the flex row does not
 * draw, so the text a tool reads off the tab is `title scope`, as the name says it, and not the two words run together. The card (hover and keyboard focus, SCD1) takes the place of a plain-text
 * tooltip. The close control is the pointer's, as the document tab's is: a tablist owns tabs and nothing else, so it is hidden from the accessibility tree and out of the tab order, and the keyboard
 * closes a session with Delete.
 */
function SessionTab({ id, stop, selected, controls, prefix, menu, renaming, onRenamed }: SessionTabProps) {
  const { store } = usePanel();
  const item = useSessionItem(id);
  const tool = useToolItem(item?.tool ?? '');
  if (item === undefined) {
    return null;
  }

  if (renaming) {
    return (
      <div className={styles.sessionItem} data-tab-id={id} data-selected={selected ? '' : undefined} data-shell-part="sessionTab">
        <SessionRename
          title={item.title}
          onDone={(title, refocus) => {
            onRenamed(id, title, refocus);
          }}
        />
      </div>
    );
  }

  const stateGlyph = item.state === 'running' ? undefined : STATE_GLYPHS[item.state];
  const toolGlyph = tool !== undefined && isIconName(tool.icon) ? tool.icon : FALLBACK_GLYPH;
  return (
    <div className={styles.sessionItem} data-tab-id={id} data-selected={selected ? '' : undefined} data-shell-part="sessionTab" data-ov-menu-label={`Actions for ${item.name}`} {...menuTrigger(menu, id, 'context')} {...hoverCardAnchor()}>
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
            <>
              {' '}
              <span className={styles.sessionScope} data-shell-part="sessionScope">
                <Text variant="caption" tone="muted">
                  {item.scope}
                </Text>
              </span>
            </>
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
 * The session tabs of the tool on screen, "<Tool> sessions" (S113): a scroller of faces, one tab stop, the keyboard contract of every strip of the shell (`useTablist`), Alt+Shift with an arrow, Home or End (or a drag with the pointer) moves a session within the strip, Delete closes the
 * session and hands the focus to its neighbour; the last session has none, and the focus goes to the tool's own tab (as the close chord does, `usePanelChords`) and not to the document, the
 * tab that had it being gone. It scrolls sideways only and keeps each tab's width: a strip squeezed to a minimum width is illegible (SCT1).
 */
export function SessionTabs({ tool, prefix, controls }: SessionTabsProps) {
  const { store, stopOf } = usePanel();
  const label = useToolItem(tool)?.label ?? 'Tool';
  const ids = useSessionIds(tool);
  const active = useActiveSession(tool);
  const [renaming, setRenaming] = useState<SessionId | null>(null);
  const say = useMaybeNotices()?.announcer.polite.announce;
  const close = (id: SessionId): boolean => {
    const closed = store.closeSession(id);
    if (closed.status === 'done' && closed.active === null) {
      focusTab('panelTools', tool);
    }

    return closed.status === 'done';
  };

  // One menu for the strip, keyed by the session it opened on (docs/ui-next/status/kit-menus.md). Every close is the panel's own `closeSession`: a terminal that runs something asks first, one question at a time.
  const menu = useMenu((key) => {
    const at = key === undefined ? -1 : ids.indexOf(key);
    if (key === undefined || at < 0) {
      return null;
    }

    const closing = (id: string, text: string, set: readonly SessionId[], none: string): MenuItem => ({
      kind: 'action',
      id,
      label: text,
      disabled: set.length === 0 ? none : false,
      onSelect: () => {
        for (const one of set) {
          store.closeSession(one);
        }
      },
    });
    return [
      {
        kind: 'action',
        id: 'rename',
        label: 'Rename session…',
        disabled: store.getSnapshot().sessions[key]?.held === true ? 'The plugin was unloaded: this session stays as it is until it is closed.' : false,
        onSelect: () => {
          setRenaming(key);
        },
      },
      ...(stopOf === undefined
        ? []
        : [
          {
            kind: 'action' as const,
            id: 'stop',
            label: 'Stop session',
            disabled: stopOf(key) !== undefined && ['starting', 'running'].includes(store.getSnapshot().sessions[key]?.state ?? '') ? false : 'The session isn\'t running.',
            onSelect: () => {
              stopOf(key)?.();
            },
          },
        ]),
      { kind: 'separator', id: 'close-group' },
      {
        kind: 'action',
        id: 'close',
        label: 'Close session',
        shortcut: closeChordText(platformOf(navigator)),
        onSelect: () => {
          close(key);
        },
      },
      closing('close-others', 'Close other sessions', ids.filter((one) => one !== key), 'There are no other sessions'),
      closing('close-right', 'Close sessions to the right', ids.slice(at + 1), 'There are no sessions to the right'),
      closing('close-left', 'Close sessions to the left', ids.slice(0, at), 'There are no sessions to the left'),
    ];
  }, ids);
  // The strip says where the session went, as the page strip does (ch16 S45).
  const onMove = (id: SessionId, to: number): boolean => {
    if (store.reorderSession(id, to).status !== 'done') {
      return false;
    }

    const state = store.getSnapshot();
    say?.(`${store.selectors.sessionItem(state, id)?.name ?? ''} moved to position ${String(store.selectors.sessionIds(state, tool).indexOf(id) + 1)} of ${String(ids.length)}`);
    return true;
  };

  const { ref, stop, handlers } = useTablist({ ids, selected: active, onClose: close, onMove });
  if (ids.length === 0) {
    return null;
  }

  return (
    <div ref={ref} className={styles.sessionList} role="tablist" aria-label={`${label} sessions`} data-shell-part="sessionTabs" {...handlers}>
      {ids.map((id) => (
        <SessionTab
          key={id}
          id={id}
          stop={id === stop}
          selected={id === active}
          controls={controls}
          prefix={prefix}
          menu={menu}
          renaming={id === renaming}
          onRenamed={(session, title, refocus) => {
            setRenaming(null);
            if (title !== null) {
              store.retitleSession(session, title);
            }

            if (refocus) {
              focusTab('sessionTabs', session);
            }
          }}
        />
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
