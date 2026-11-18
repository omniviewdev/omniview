import { StatusSummary } from '@omniviewdev/kit';
import styles from './StatusSummary.examples.module.css';

/** The line that leads an overview: a status, a bold value with what it counts, plain facts, a muted dot between the parts. */
export const OverviewLine = () => (
  <StatusSummary
    label="orders-api status"
    items={[{ status: { role: 'healthy', label: 'Available' } }, { value: '3/3', label: 'ready' }, { text: 'up to date' }, { text: 'last rollout 3 days ago' }]}
  />
);

/** A status, a value that is not at its goal and a text, all in the error tone: the colour is the state's and the words say it too. */
export const Degraded = () => (
  <StatusSummary
    label="orders-api status"
    items={[{ status: { role: 'error', label: 'Degraded' } }, { value: '2/3', label: 'ready', tone: 'error' }, { text: '1 unavailable', tone: 'error' }]}
  />
);

/** A tone on a value and its label: success. */
export const ToneSuccess = () => <StatusSummary label="Rollout status" items={[{ value: '3/3', label: 'ready', tone: 'success' }, { text: 'up to date', tone: 'success' }]} />;

/** A tone on a value and a text: warning. */
export const ToneWarning = () => <StatusSummary label="Rollout status" items={[{ value: '2/3', label: 'ready', tone: 'warning' }, { text: 'waiting for 1 item', tone: 'warning' }]} />;

/** A tone on a value and a text: error. */
export const ToneError = () => <StatusSummary label="Rollout status" items={[{ value: '0/3', label: 'ready', tone: 'error' }, { text: 'rollout failed', tone: 'error' }]} />;

/** A tone on a value and a text: info, in the link colour. */
export const ToneInfo = () => <StatusSummary label="Rollout status" items={[{ value: '3', label: 'updates', tone: 'info' }, { text: 'update available', tone: 'info' }]} />;

/** A tone on a value and a text: muted. */
export const ToneMuted = () => <StatusSummary label="Rollout status" items={[{ value: '0/3', label: 'ready', tone: 'muted' }, { text: 'paused', tone: 'muted' }]} />;

/** A value with no label after it: the bold value alone. */
export const ValueOnly = () => <StatusSummary label="Item count" items={[{ value: '12' }]} />;

/** A text with no status: plain facts only. */
export const TextOnly = () => <StatusSummary label="Item facts" items={[{ text: 'up to date' }, { text: 'last rollout 3 days ago' }]} />;

/** A line longer than its box wraps: 4 px between the lines, 8 px between the parts. */
export const LongLineWraps = () => (
  <div className={styles.narrow}>
    <StatusSummary
      label="orders-api status"
      items={[
        { status: { role: 'healthy', label: 'Available' } },
        { value: '3/3', label: 'ready' },
        { text: 'up to date' },
        { text: 'last rollout 3 days ago' },
        { text: 'owned by north-yard' },
        { text: 'scaled by schedule' },
      ]}
    />
  </div>
);

/** A single status: no dot. */
export const SingleStatus = () => <StatusSummary label="orders-api status" items={[{ status: { role: 'running', label: 'Running' } }]} />;

/** Work that waits to start is the progress role with the clock. */
export const QueuedStatus = () => (
  <StatusSummary label="orders-api status" items={[{ status: { role: 'progress', label: 'Pending', queued: true } }, { text: 'starts in 4 min' }]} />
);
