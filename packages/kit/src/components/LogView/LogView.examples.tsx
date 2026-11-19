import { LogView } from '@omniviewdev/kit';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { ExampleStage } from './ExampleStage';
import styles from './LogView.examples.module.css';
import { SyntheticFeed, type SyntheticFeedOptions } from './syntheticFeed';

// The lines of every example are neutral and made from a seed (syntheticFeed.ts), with a clock that does not move, so an example is the same on every
// visit. The two that stream use the real clock and a modest rate: the parts page mounts every example at once.
const FIXED_CLOCK = () => Date.UTC(2024, 0, 15, 10, 30, 0);

function Stage({ children }: { readonly children: ReactNode }) {
  return <ExampleStage boxClass={styles.stage}>{children}</ExampleStage>;
}

/**
 * The session behind one example: its feed, what streams into it, and what the example does to it. It is the CHILD of the stage, so all of it begins when the stage mounts it (when the
 * example comes near the screen) and not when the page mounts every example: an example then shows the same however long it waited offscreen, and one that nobody scrolled to makes
 * no 20,000-line fixture and starts no stream. The feed is made once and is the same while the example is mounted; `stream` runs it at its rate and `script` does what the example
 * shows to it (it returns what undoes it), and both end when the example unmounts. `make` and `script` are written outside the component so that they are the same functions on every render.
 */
function Session({
  make,
  stream = false,
  script,
  children,
}: {
  readonly make: () => SyntheticFeed;
  readonly stream?: boolean;
  readonly script?: ((feed: SyntheticFeed) => () => void) | undefined;
  readonly children: (feed: SyntheticFeed) => ReactElement;
}) {
  const [feed] = useState(make);
  useEffect(() => {
    if (stream) {
      feed.start();
    }

    const undo = script?.(feed);
    return () => {
      undo?.();
      if (stream) {
        feed.stop();
      }
    };
  }, [feed, stream, script]);
  return children(feed);
}

function made(lines: number, options: SyntheticFeedOptions = {}): SyntheticFeed {
  const feed = new SyntheticFeed({ clock: FIXED_CLOCK, ...options });
  feed.emit(lines);
  return feed;
}

const makeStreaming = () => made(200, { rate: 20, clock: () => Date.now() });

/** A session that is running: 200 lines to start from, then about 20 a second. It follows the end of the log; scroll up and the strip offers the way back. */
export const Streaming = () => (
  <Stage>
    <Session make={makeStreaming} stream>
      {(feed) => <LogView label="worker-0 · app" feed={feed} />}
    </Session>
  </Stage>
);

const makeStarting = () => new SyntheticFeed({ state: 'starting' });

/** A log with no stream behind it yet: the feed is connecting. */
export const Starting = () => (
  <Stage>
    <Session make={makeStarting}>{(feed) => <LogView label="worker-0 · app" feed={feed} />}</Session>
  </Stage>
);

const makeWaiting = () => new SyntheticFeed({ clock: FIXED_CLOCK });

/** Connected, and no line has come. */
export const WaitingForLines = () => (
  <Stage>
    <Session make={makeWaiting}>{(feed) => <LogView label="worker-0 · app" feed={feed} />}</Session>
  </Stage>
);

const makePaused = () => made(120);
/** The pause comes after the view has read the 120 lines, whenever the view mounted: the 340 that come after it are held. */
const pauseAfterTheFirstRead = (feed: SyntheticFeed) =>
  feed.whenDrained(() => {
    feed.pause();
    feed.emit(340);
  });

/** The feed is paused after 120 lines were read: nothing more is read, the list stands still, and the strip says how many lines are waiting and offers Resume. */
export const Paused = () => (
  <Stage>
    <Session make={makePaused} script={pauseAfterTheFirstRead}>
      {(feed) => <LogView label="worker-0 · app" feed={feed} />}
    </Session>
  </Stage>
);

const makeEnded = () => {
  const ended = made(80);
  ended.setState('ended');
  return ended;
};

/** The stream ended on its own: the log is what it was, and there is no end to follow. */
export const Ended = () => (
  <Stage>
    <Session make={makeEnded}>{(feed) => <LogView label="worker-0 · app" feed={feed} />}</Session>
  </Stage>
);

const makeFailed = () => {
  const failed = made(60);
  failed.setState('failed', { stage: 'source', source: 'source/main', message: 'connection reset by peer' });
  return failed;
};

/** The stream failed after it had run: the lines stay, one notice at the foot of them says what stopped and why. */
export const Failed = () => (
  <Stage>
    <Session make={makeFailed}>{(feed) => <LogView label="worker-0 · app" feed={feed} />}</Session>
  </Stage>
);

const makeFailedBeforeAnyLine = () => {
  const failed = new SyntheticFeed({ state: 'starting' });
  failed.setState('failed', { stage: 'create', message: 'The plugin is not running' });
  return failed;
};

/** The stream failed before a line came: the notice is the body of the log. */
export const FailedBeforeAnyLine = () => (
  <Stage>
    <Session make={makeFailedBeforeAnyLine}>{(feed) => <LogView label="worker-0 · app" feed={feed} />}</Session>
  </Stage>
);

const makeSearch = () => made(400);

/** A search with matches: the count is inside the field, the matches are marked, the current line has the accent. Enter and Shift+Enter step through them. */
export const Search = () => (
  <Stage>
    <Session make={makeSearch}>{(feed) => <LogView label="worker-0 · app" feed={feed} defaultQuery="ms" />}</Session>
  </Stage>
);

const makeDropped = () => made(12);
/** The gap is reported after the view has read the 12 lines, whenever the view mounted: the marker stands between them and the five that follow. */
const dropAfterTheFirstRead = (feed: SyntheticFeed) =>
  feed.whenDrained(() => {
    feed.drop(1250);
    feed.emit(5);
  });

/** The feed dropped lines (the reader was too slow, or the view was hidden): a marker stands where they would have been. */
export const DroppedLines = () => (
  <Stage>
    <Session make={makeDropped} script={dropAfterTheFirstRead}>
      {(feed) => <LogView label="worker-0 · app" feed={feed} />}
    </Session>
  </Stage>
);

const makeLongLines = () => {
  const long = new SyntheticFeed({ clock: FIXED_CLOCK, seed: 7 });
  long.push([
    long.line(`${'key=value '.repeat(60)}end of a very long line`, 'info'),
    long.line('a short line', 'info'),
    long.line(`${'payload '.repeat(80)}`, 'warn'),
  ]);
  long.emit(60);
  return long;
};

/** Lines wider than the list scroll sideways; the rows stay one line high. */
export const LongLines = () => (
  <Stage>
    <Session make={makeLongLines}>{(feed) => <LogView label="worker-0 · app" feed={feed} />}</Session>
  </Stage>
);

const makeMany = () => made(20_000);

/** 20,000 lines: the list mounts the rows in view and a few more, whatever the log holds. */
export const ManyLines = () => (
  <Stage>
    <Session make={makeMany}>{(feed) => <LogView label="worker-0 · app" feed={feed} />}</Session>
  </Stage>
);
