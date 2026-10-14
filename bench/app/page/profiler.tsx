/**
 * Wraps the app root in a React <Profiler> (the profiling build aliases
 * react-dom/client to react-dom/profiling, so onRender fires in production
 * React) and accumulates commit totals on `window.__ovProfile`. Plugin screens
 * render inside the same root, so they are included.
 */
import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';

export interface ProfileTotals {
  commits: number;
  mounts: number;
  updates: number;
  /** Sum of actualDuration: time spent rendering the committed trees (ms). */
  actualMs: number;
  /** Largest single commit's actualDuration (ms). */
  maxActualMs: number;
  /** Commits whose render took longer than one 60 Hz frame. */
  slowCommits: number;
}

const empty = (): ProfileTotals => ({ commits: 0, mounts: 0, updates: 0, actualMs: 0, maxActualMs: 0, slowCommits: 0 });

const state = {
  totals: empty(),
  /** Returns the totals since the last reset and starts a new window. */
  take(): ProfileTotals {
    const t = state.totals;
    state.totals = empty();
    return t;
  },
};
(window as any).__ovProfile = state;

const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
  const t = state.totals;
  t.commits++;
  if (phase === 'mount') t.mounts++;
  else t.updates++;
  t.actualMs += actualDuration;
  if (actualDuration > t.maxActualMs) t.maxActualMs = actualDuration;
  if (actualDuration > 16.7) t.slowCommits++;
};

export function ProfiledRoot({ children }: { children: ReactNode }) {
  return <Profiler id="app" onRender={onRender}>{children}</Profiler>;
}
