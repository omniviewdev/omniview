/**
 * Wraps the app root in a React <Profiler> (the profiling build aliases
 * react-dom/client to react-dom/profiling, so onRender fires in production
 * React) and accumulates commit totals on `window.__ovProfile`. Plugin screens
 * render inside the same root, so they are included.
 *
 * Only the profiling build installs this. The normal build has no <Profiler> and no
 * `window.__ovProfile`, and every React column of its results is unavailable (null).
 * The profiling build's own instrumentation (this callback and React's profiling
 * renderer) costs real time, so its timings are never comparable with a normal build's.
 */
import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';

export interface SlowCommit {
  /** Commit time in the page's performance.now() timebase, ms. */
  at: number;
  /** Rendering time of that commit, ms. */
  ms: number;
  phase: string;
}

export interface ProfileTotals {
  commits: number;
  /** Commits whose phase is `mount`. */
  mounts: number;
  /** Commits whose phase is `update` or `nested-update`. */
  updates: number;
  /** Sum of actualDuration: time spent rendering the committed trees (ms). */
  actualMs: number;
  /** actualDuration summed over mount commits (ms). */
  mountMs: number;
  /** actualDuration summed over update commits (ms). */
  updateMs: number;
  /** Sum of baseDuration: what the same trees would cost without memoization (ms). */
  baseMs: number;
  /** Largest single commit's actualDuration (ms). */
  maxActualMs: number;
  /** Commits whose render took longer than one 60 Hz frame. */
  slowCommits: number;
  /** The slowest commits of the window, bounded, in commit order. */
  slow: SlowCommit[];
}

const SLOW_COMMIT_MS = 16.7;
const MAX_SLOW_LIST = 64;

const empty = (): ProfileTotals => ({
  commits: 0, mounts: 0, updates: 0, actualMs: 0, mountMs: 0, updateMs: 0, baseMs: 0, maxActualMs: 0, slowCommits: 0, slow: [],
});

/** What `window.__ovProfile` offers: the totals since the last call, then a fresh window. */
export interface ProfileApi {
  take(): ProfileTotals;
}

const state = {
  totals: empty(),
  /** Returns the totals since the last reset and starts a new window. */
  take(): ProfileTotals {
    const t = state.totals;
    state.totals = empty();
    return t;
  },
};
window.__ovProfile = state satisfies ProfileApi;

const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration, baseDuration, _startTime, commitTime) => {
  const t = state.totals;
  t.commits++;
  t.actualMs += actualDuration;
  t.baseMs += baseDuration;
  if (phase === 'mount') {
    t.mounts++;
    t.mountMs += actualDuration;
  } else {
    t.updates++;
    t.updateMs += actualDuration;
  }
  if (actualDuration > t.maxActualMs) t.maxActualMs = actualDuration;
  if (actualDuration > SLOW_COMMIT_MS) {
    t.slowCommits++;
    if (t.slow.length < MAX_SLOW_LIST) t.slow.push({ at: commitTime, ms: actualDuration, phase });
  }
};

export function ProfiledRoot({ children }: { children: ReactNode }) {
  return <Profiler id="app" onRender={onRender}>{children}</Profiler>;
}
