import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import type { SearchOptions } from '../../log/lineSearch';
import { DEFAULT_MAX_LINES, LogViewModel } from '../../log/logViewModel';
import type { LogFeed } from '../../log/types';
import { emptyText, failureWords } from '../../log/words';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { FindBar } from './FindBar';
import { LevelFilter } from './LevelFilter';
import { LogList } from './LogList';
import { StatusStrip } from './StatusStrip';
import styles from './LogView.module.css';

/** The props of the log view. Closed: no `className`, no `style`; `data-*` passes through to its root. */
export type LogViewProps = {
  /** The session's name ("worker-0 · app"): the accessible name of the log and of its list. Required: a list of lines with no name says nothing. */
  readonly label: string;
  /** Where the lines come from. The view reads it at its own pace, one animation frame at a time, and never holds more than `maxLines`. */
  readonly feed: LogFeed;
  /**
   * The most lines the view keeps; older ones are dropped and counted. Default 100,000 (docs/ui-next/optimisations.md HLT-4). Changing it keeps the lines the view holds: a larger
   * cap keeps them all, a smaller one drops the oldest of them (counted as dropped, as any the cap pushes out). Another `feed` is another view, and starts empty.
   */
  readonly maxLines?: number | undefined;
  /** What the search field holds when the view first appears. */
  readonly defaultQuery?: string | undefined;
} & DataAttributes;

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * The log viewer: a find bar and a level quick filter over a windowed list of lines, and a status strip (design 16 S120). It is fed by a feed (see
 * `LogFeed`): lines are read once per animation frame into a bounded buffer, so a stream of 10,000 lines a second is a frame's worth of work a frame, not a
 * render a line. It follows the end of the log until the reader scrolls up, and says how to get back. It shows where it is (starting, streaming, paused,
 * ended, failed with its cause) and what it dropped. The list is one tab stop; the arrows, Page, Home and End move the active line, and the find field
 * takes Enter and Shift+Enter for the next and previous match. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function LogView({ label, feed, maxLines = DEFAULT_MAX_LINES, defaultQuery = '', ...rest }: LogViewProps) {
  // The view of a feed is made once for it: the feed gives each line once, so a view made again would have lost every line it had already given. The cap is told to the view that
  // exists in the layout phase of the commit that changes it, which no animation frame comes between: a frame that read in the gap between that commit and its passive effects would
  // find the old cap and evict lines the new one keeps, which cannot be given back. The view is made with the cap this component first had.
  const [firstMaxLines] = useState(maxLines);
  const model = useMemo(() => new LogViewModel(feed, { maxLines: firstMaxLines }), [feed, firstMaxLines]);
  useLayoutEffect(() => {
    model.setMaxLines(maxLines);
  }, [model, maxLines]);
  useEffect(() => {
    model.attach();
    return () => {
      model.detach();
    };
  }, [model]);

  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const status = useSyncExternalStore(feed.subscribe, feed.getSnapshot);
  const [options, setOptions] = useState<SearchOptions>({ query: defaultQuery, regex: false, caseSensitive: false });
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // A new model (another feed) starts with the search the reader has typed.
  const applySearch = useEffectEvent(() => {
    model.setSearch(options);
  });
  useEffect(() => {
    applySearch();
  }, [model]);

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Find in logs: ⌘F on macOS, Ctrl+Shift+F elsewhere (the mock's `host.panel.find`), from anywhere in the view.
    const chord = MAC ? event.metaKey && !event.ctrlKey && !event.shiftKey : event.ctrlKey && event.shiftKey && !event.metaKey;
    if (chord && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      const input = rootRef.current?.querySelector('input[type="search"]');
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    }
  };

  // A stream that was created has started, whatever lines it brought: only a creation that failed (stage `create`) is one that never started. Lines held are proof of a stream that ran too.
  const failed = status.state === 'failed' && status.cause !== undefined ? failureWords(status.cause, status.cause.stage !== 'create' || snapshot.buffered > 0) : undefined;
  const empty = snapshot.count === 0 ? emptyText({ state: status.state, filtered: snapshot.minRank > 0, buffered: snapshot.buffered }) : undefined;
  // The cause is the body of the log only when there is nothing else to say in the body: no line to show and no filter to clear. A filter that hides every
  // line gets its own message and its button, and the cause stays at the foot of the list, as it does when there are lines: the failure is the stream's, and
  // the reader must not have to clear a filter to learn it.
  const failureIsBody = failed !== undefined && empty !== undefined && !empty.clear;
  const failure =
    failed === undefined ? null : (
      <div className={styles.notice} role="alert">
        <Icon name="status-error" />
        <span className={styles.noticeText}>
          <b>{failed.title}.</b> {failed.message}
        </span>
      </div>
    );

  return (
    <div {...dataAttributes(rest)} ref={rootRef} className={styles.root} role="group" aria-label={`Log, ${label}`} onKeyDown={onRootKeyDown}>
      <div className={styles.filters} role="group" aria-label="Log filters">
        <FindBar
          options={options}
          onOptionsChange={(next) => {
            setOptions(next);
            model.setSearch(next);
          }}
          search={snapshot.search}
          model={model}
          listRef={listRef}
        />
        <LevelFilter
          rank={snapshot.minRank}
          onChange={(rank) => {
            model.setMinRank(rank);
          }}
        />
      </div>
      <div className={styles.main}>
        <LogList model={model} snapshot={snapshot} label={label} listRef={listRef} />
        {empty === undefined ? null : (
          <div className={styles.overlay}>
            {failureIsBody ? (
              <div className={styles.failure} data-ov-body="true">
                {failure}
              </div>
            ) : (
              <div className={styles.empty} role="status">
                {empty.text}
                {empty.clear ? (
                  <Button
                    size="compact"
                    onClick={() => {
                      model.setMinRank(0);
                      // The button goes with the filter that put it there: the focus it held goes to the list, whose keys work on the lines that come back.
                      listRef.current?.focus();
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        )}
        {failed !== undefined && !failureIsBody ? <div className={styles.failure}>{failure}</div> : null}
      </div>
      <StatusStrip
        model={model}
        state={status.state}
        paused={status.paused}
        following={snapshot.following}
        onResume={() => {
          feed.resume();
          // The button goes with the pause: the focus it held goes to the list, as it does for Jump to latest.
          listRef.current?.focus();
        }}
        onJumpToLatest={() => {
          model.jumpToLatest();
          listRef.current?.focus();
        }}
      />
    </div>
  );
}
