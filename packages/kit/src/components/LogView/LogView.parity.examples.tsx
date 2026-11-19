// The fixtures of the log parity probe (packages/kit/probes/log-probe.mjs): the lines of the design mock's own measurement of its Logs tool
// (`L.lines` of mock-log-measure.mjs), in a feed that makes them once and never streams, so a reading of the log is the same on every visit.
// The lines: a level cycle of ten (info, warn, error, info, debug, info, warn, info, debug, info), a clock that moves 1,013 ms a line from
// 10:00:00.000, every third line says `request`, line 4 holds an ANSI span (an amber `retry budget`) and line 10 is 450 characters long.
// The probe pins an example to the size of the mock's tool (1390 x 229 at 1440 x 900), sets the page to UTC and compares what the log draws with
// what the mock drew. `List` is the mock's list scenario (90 lines, at the end of the log, following), `Find` its find scenario (110 lines),
// `Keys` its keys and copy scenarios (100 lines).
import { LogView } from '@omniviewdev/kit';
import { useState } from 'react';
import { ExampleStage } from './ExampleStage';
import styles from './LogView.parity.module.css';
import { SyntheticFeed } from './syntheticFeed';

const BASE = Date.UTC(2026, 0, 15, 10, 0, 0);
const LEVELS = ['info', 'warn', 'error', 'info', 'debug', 'info', 'warn', 'info', 'debug', 'info'] as const;

/** The mock's `L.lines(0, count)`, in a feed that holds them for the view's first frame. */
function mockFeed(count: number): SyntheticFeed {
  let index = 0;
  const feed = new SyntheticFeed({ rate: 0, clock: () => BASE + index * 1013 });
  const lines = [];
  for (index = 0; index < count; index += 1) {
    let text = index % 3 === 0 ? `request ${index} served in ${10 + ((index * 7) % 90)} ms` : `worker ${index % 5} reconciled ${index} objects`;
    if (index === 3) {
      text = `Applied \u001b[33mretry budget\u001b[0m to upstream ${index}`;
    }

    if (index === 9) {
      text = `request ${index} ${'very-long-message-segment '.repeat(18)}end`;
    }

    lines.push(feed.line(text, LEVELS[index % 10]));
  }

  feed.push(lines);
  return feed;
}

/** The session is the stage's child, so its feed is made when the stage mounts it (near the screen), not when the page mounts every example. */
function Session({ count }: { readonly count: number }) {
  const [feed] = useState(() => mockFeed(count));
  return <LogView label="Omniview host logs" feed={feed} />;
}

function Stage({ count }: { readonly count: number }) {
  return (
    <ExampleStage boxClass={styles.stage}>
      <Session count={count} />
    </ExampleStage>
  );
}

/** The mock's list: 90 lines, the list at its end and following, the strip saying so. */
export const List = () => <Stage count={90} />;

/** The mock's find scenario: 110 lines, 36 of them say `request`. */
export const Find = () => <Stage count={110} />;

/** The mock's keys and copy scenarios: 100 lines, the list at its end. */
export const Keys = () => <Stage count={100} />;
