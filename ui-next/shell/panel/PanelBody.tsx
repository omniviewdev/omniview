import { isIconName } from '@omniviewdev/kit';
import { useRef } from 'react';
import type { SessionId } from '../core/panel';
import { usePanel } from './context';
import { useActiveSession, useActiveTool, useIsShown, useMounted, useOpen, usePaneActive, usePaneId, usePaneIndex, usePaneLayout, usePaneSeatOf, usePaneShare, useSession, useToolItem } from './hooks';
import { PaneRoomProvider, PaneSeatProvider } from './panes/room';
import { deckOrder } from './panes/order';
import { PaneSash } from './panes/PaneSash';
import { usePaneDeck } from './panes/usePaneDeck';
import styles from './Panel.module.css';
import { PanelEmpty } from './PanelEmpty';
import { bodyId, sessionTabId, toolTabId } from './words';

type SlotProps = { readonly id: SessionId; readonly prefix: string };

/**
 * One mounted body. A body is mounted when its session is first shown and lives as long as the session does, so a session that streams keeps its buffer while another is on screen and while
 * the panel is hidden (docs/ui-next/optimisations.md HLT-32, MNR-X4). The slot that is not on screen is `hidden` (`display: none`): the browser does no layout and no paint for it, the same
 * technique as the page host's, but NOT React's `Activity`, which releases effects: a stream must not stop while its body is out of sight. The body is told whether it is `visible` and
 * may skip the work only a visible body needs. The slot reads its own session and whether it is on screen, and renders for nothing else: a change in another session leaves it alone.
 */
function BodySlot({ id, prefix }: SlotProps) {
  const { store, renderBody } = usePanel();
  const session = useSession(id);
  const shown = useIsShown(id);
  // A body in a group of panes sits in its pane's place (`order`: the panes are laid out in the group's order whatever order the bodies were mounted in, which is not moved so that no body is remounted) and takes its share of
  // the room (`--_share`); a click or the keyboard in it makes its pane the active one.
  const index = usePaneIndex(id);
  const share = usePaneShare(id);
  const pane = usePaneId(id);
  const active = usePaneActive(id);
  const seat = usePaneSeatOf(id);
  if (session === undefined) {
    return null;
  }

  const placed = index >= 0 && shown;
  return (
    <div
      id={bodyId(prefix, id)}
      className={styles.slot}
      hidden={!shown}
      style={{ '--_share': placed ? String(share) : undefined }}
      data-shell-part="panelBody"
      data-session-id={id}
      data-pane={placed ? pane : undefined}
      data-pane-active={placed && active ? '' : undefined}
      onFocus={
        placed
          ? () => {
            store.focusPane(session.tool, pane);
          }
          : undefined
      }
      onPointerDownCapture={
        placed
          ? () => {
            store.focusPane(session.tool, pane);
          }
          : undefined
      }
    >
      <PaneSeatProvider value={seat === '' ? null : { index: Number(seat.split('/')[0]) - 1, count: Number(seat.split('/')[1]) }}>{renderBody(session, shown)}</PaneSeatProvider>
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
 * place, the empty state: no tool at all, or a tool with no session. A tool with no session shows the button that starts one when its owner says how. A tool that has no sessions at all (a singleton,
 * Problems and Operations: ch16 S114) is drawn by the host (`renderTool`), only while it is on screen with the panel open, and replaces both the bodies and the empty state.
 */
export function PanelBody({ prefix, id }: PanelBodyProps) {
  const { newSessionOf, emptyOf, renderTool } = usePanel();
  const mounted = useMounted();
  const open = useOpen();
  const tool = useActiveTool();
  const active = useActiveSession(tool);
  const item = useToolItem(tool ?? '');
  const add = tool === null ? undefined : newSessionOf(tool);
  const words = tool === null ? undefined : emptyOf?.(tool);
  const singleton = tool === null || !open ? undefined : renderTool?.(tool);
  const layout = usePaneLayout(open ? tool : null);
  const deck = useRef<HTMLDivElement>(null);
  const room = usePaneDeck(deck, tool, layout);
  const several = layout !== null && layout.panes.length > 1;
  const labelledBy = active !== null ? sessionTabId(prefix, active) : tool !== null ? toolTabId(prefix, tool) : undefined;
  return (
    <div
      ref={deck}
      id={id}
      className={styles.body}
      role="tabpanel"
      aria-labelledby={labelledBy}
      aria-label={labelledBy === undefined ? 'Panel' : undefined}
      data-axis={several ? layout.axis : undefined}
      data-shell-part="panelDeck"
    >
      {tool === null ? <PanelEmpty icon="panel-bottom" title="No tools" hint="Tools appear here when a plugin brings one." /> : null}
      {tool !== null && active === null && singleton === undefined ? (
        <PanelEmpty
          icon={item !== undefined && isIconName(item.icon) ? item.icon : 'box'}
          title={words?.title ?? 'No sessions'}
          hint={words?.hint ?? 'A session of this tool appears here when you start one.'}
          action={add === undefined ? undefined : { label: add.label, icon: 'plus', onSelect: add.start }}
        />
      ) : null}
      {tool === null || singleton === undefined ? null : (
        <div key={tool} id={bodyId(prefix, tool)} className={styles.slot} data-shell-part="panelBody" data-tool-id={tool}>
          {singleton}
        </div>
      )}
      <PaneRoomProvider value={room}>
        {deckOrder(mounted, several ? layout.panes.map((one) => one.session) : []).map((item) =>
          item.kind === 'body' ? (
            <BodySlot key={item.session} id={item.session} prefix={prefix} />
          ) : tool === null || layout === null ? null : (
            <PaneSash key={`sash-${item.session}`} deck={deck} tool={tool} axis={layout.axis} boundary={item.boundary} sessions={layout.panes.map((one) => one.session)} ratios={layout.ratios} prefix={prefix} />
          ),
        )}
      </PaneRoomProvider>
    </div>
  );
}
