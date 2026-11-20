import { LogView } from '@omniviewdev/kit';
import { Activity } from 'react';
import type { Session } from '../../core/panel';
import { EmptyState } from '../EmptyState';
import type { LogStreams } from './LogStreams';
import { LOGS_GONE, LOGS_ICON } from './tool';
import styles from './LogsBody.module.css';

type LogsBodyProps = {
  /** Where the session's stream is held. */
  readonly streams: LogStreams;
  readonly session: Session;
  /** The panel is open and this is the session on screen. */
  readonly visible: boolean;
};

/**
 * The body of a Logs session: the kit's log view over the stream the registry holds for it (docs/ui-next/status/P1b-3a.md). The panel keeps every body mounted from the first time it is shown until its
 * session closes (a streaming session keeps its lines: HLT-32), so what a body does while it is NOT on screen is the host's to decide here:
 *
 *   - the STREAM is the registry's and goes on while the body is hidden, holding its lines up to its own bound (counted when it drops, the view says so when it comes back);
 *   - the VIEW is hidden with React's `Activity`: its effects are released, so it holds no listener on the stream, asks for no frame and runs no clock; its state stays, so the lines it had, its place,
 *     its search and its filter come back as they were, and the browser does no layout and no paint for it (`display: none`, which keeps the offset of a scroller). When it is shown again it reads
 *     what the stream held meanwhile, over frames, and follows the tail if it was following.
 *
 * (The panel's own slot cannot do this: it hides a body with `hidden` and no more, because a plugin's body may need its effects to run while it is out of sight. This body's stream is not in its
 * effects.) A session with no stream (restored from the last run, or whose plugin was unloaded and came back: the panel hid it while the plugin was off, and the host closed its stream) has nothing
 * to read and nothing to search, so it is no view: it says that the earlier lines are gone and how to get logs again (`LOGS_GONE`).
 */
export function LogsBody({ streams, session, visible }: LogsBodyProps) {
  const feed = streams.feedOf(session.id);
  if (feed === undefined) {
    return <EmptyState icon={LOGS_ICON} title={LOGS_GONE.title} hint={LOGS_GONE.hint} />;
  }

  return (
    <div className={styles.log} data-shell-part="logsBody">
      <Activity mode={visible ? 'visible' : 'hidden'}>
        <LogView label={session.scope === '' ? session.title : `${session.title} · ${session.scope}`} feed={feed} data-log-session={session.id} />
      </Activity>
    </div>
  );
}
