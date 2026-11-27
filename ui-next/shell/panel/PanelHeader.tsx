import { IconButton, RovingGroup, tip } from '@omniviewdev/kit';
import { hidePanel, togglePanelMaximized } from './focus';
import { usePanel } from './context';
import { useActiveTool, useSessionIds } from './hooks';
import styles from './Header.module.css';
import { NewSession, SessionTabs } from './SessionTabs';
import { ToolTabs } from './ToolTabs';
import { maximizeChordText, toggleChordText } from './words';
import type { Platform } from '../core/chords';

type PanelHeaderProps = {
  readonly prefix: string;
  /** The id of the body region the tabs switch. */
  readonly controls: string;
  readonly platform: Platform;
  readonly maximized: boolean;
};

/**
 * The panel's header, 41 px (ch16 S113): the tool tabs, a 1 x 16 px separator, the session tabs of the tool on screen with the `+` that starts one, and the trailing actions. It reads which
 * tool is on screen and whether that tool has sessions, and nothing of a session: a session changing state renders its own tab. Not built: the options menu
 * (docs/ui-next/status/P1a.md, "What later tools need").
 */
export function PanelHeader({ prefix, controls, maximized, platform }: PanelHeaderProps) {
  const { store, newSessionOf } = usePanel();
  const tool = useActiveTool();
  const sessions = useSessionIds(tool);
  const add = tool === null ? undefined : newSessionOf(tool);
  const hasSessions = tool !== null && (sessions.length > 0 || add !== undefined);
  return (
    <div className={styles.header} data-shell-part="panelHeader">
      <ToolTabs prefix={prefix} controls={controls} />
      {hasSessions && tool !== null ? (
        <>
          <span className={styles.separator} aria-hidden="true" data-shell-part="panelSeparator" />
          <div className={styles.sessions} data-shell-part="panelSessions">
            <SessionTabs tool={tool} prefix={prefix} controls={controls} />
            {add === undefined ? null : <NewSession label={add.label} onStart={add.start} {...(add.menu === undefined ? {} : { menu: add.menu })} />}
          </div>
        </>
      ) : null}
      <div className={styles.actions} data-shell-part="panelActions">
        <RovingGroup label="Panel actions" gap={4}>
          <IconButton
            icon={maximized ? 'copy' : 'external-link'}
            label="Maximize panel"
            pressed={maximized}
            variant="ghost"
            {...tip(`${maximized ? 'Restore panel size' : 'Maximize panel'}\n${maximizeChordText(platform)}`)}
            onClick={() => {
              togglePanelMaximized(store);
            }}
          />
          <IconButton
            icon="chevron-down"
            label="Hide panel"
            variant="ghost"
            data-shell-part="panelHide"
            data-shell-focus={tool === null ? '' : undefined}
            {...tip(`Hide panel\n${toggleChordText(platform)}`)}
            onClick={() => {
              hidePanel(store);
            }}
          />
        </RovingGroup>
      </div>
    </div>
  );
}
