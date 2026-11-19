import { isIconName } from '@omniviewdev/kit';
import type { SessionId } from '../core/panel';
import { usePanel } from './context';
import { EmptyState } from './EmptyState';
import { useActiveSession, useActiveTool, useIsShown, useMounted, useSession, useToolItem } from './hooks';
import styles from './Panel.module.css';
import { bodyId, sessionTabId, toolTabId } from './words';

type SlotProps = { readonly id: SessionId; readonly prefix: string };

/**
 * One mounted body. A body is mounted when its session is first shown and lives as long as the session does, so a session that streams keeps its buffer while another is on screen and while
 * the panel is hidden (docs/ui-next/optimisations.md HLT-32, MNR-X4). The slot that is not on screen is `hidden` (`display: none`): the browser does no layout and no paint for it, the same
 * technique as the page host's, but NOT React's `Activity`, which releases effects: a stream must not stop while its body is out of sight. The body is told whether it is `visible` and
 * may skip the work only a visible body needs. The slot reads its own session and whether it is on screen, and renders for nothing else: a change in another session leaves it alone.
 */
function BodySlot({ id, prefix }: SlotProps) {
  const { renderBody } = usePanel();
  const session = useSession(id);
  const shown = useIsShown(id);
  if (session === undefined) {
    return null;
  }

  return (
    <div id={bodyId(prefix, id)} className={styles.slot} hidden={!shown} data-shell-part="panelBody" data-session-id={id}>
      {renderBody(session, shown)}
    </div>
  );
}

type PanelBodyProps = {
  readonly prefix: string;
  /** The region's id: what the tabs control. */
  readonly id: string;
};

/**
 * The region under the header: the one tabpanel the tool tabs and the session tabs switch, labelled by the session on screen (else the tool). It holds the mounted bodies and, in their
 * place, the empty state: no tool at all, or a tool with no session. A tool with no session shows the button that starts one when its owner says how.
 */
export function PanelBody({ prefix, id }: PanelBodyProps) {
  const { newSessionOf } = usePanel();
  const mounted = useMounted();
  const tool = useActiveTool();
  const active = useActiveSession(tool);
  const item = useToolItem(tool ?? '');
  const add = tool === null ? undefined : newSessionOf(tool);
  const labelledBy = active !== null ? sessionTabId(prefix, active) : tool !== null ? toolTabId(prefix, tool) : undefined;
  return (
    <div id={id} className={styles.body} role="tabpanel" aria-labelledby={labelledBy} aria-label={labelledBy === undefined ? 'Panel' : undefined} data-shell-part="panelDeck">
      {tool === null ? <EmptyState icon="panel-bottom" title="No tools" hint="Tools appear here when a plugin brings one." /> : null}
      {tool !== null && active === null ? (
        <EmptyState
          icon={item !== undefined && isIconName(item.icon) ? item.icon : 'box'}
          title="No sessions"
          hint="A session of this tool appears here when you start one."
          action={add === undefined ? undefined : { label: add.label, onSelect: add.start }}
        />
      ) : null}
      {mounted.map((sessionId) => (
        <BodySlot key={sessionId} id={sessionId} prefix={prefix} />
      ))}
    </div>
  );
}
