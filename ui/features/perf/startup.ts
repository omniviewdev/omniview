import { DiagnosticsClient } from '@omniviewdev/runtime/api';

// Taken when this module is evaluated; main.tsx imports it first.
const mainStartMs = performance.now();

let reported = false;

/**
 * Report that the shell is interactive. Waits for the next frame to be painted
 * and the task queue to drain, then hands frontend timings to the backend,
 * which logs them (and writes them out for scripts/perf/coldstart.sh).
 * Only the first call does anything.
 */
export function reportStartupReady(): void {
  if (reported) {
    return;
  }

  reported = true;

  // WebKit pauses animation frames for hidden windows, so record the commit
  // time too, and whether the window was visible.
  const committedMs = performance.now();
  const hiddenAtCommit = document.visibilityState === 'hidden';

  requestAnimationFrame(() => {
    setTimeout(() => {
      const readyMs = performance.now();
      DiagnosticsClient.ReportStartupReady({
        nav_start_unix_ms: performance.timeOrigin,
        ui_main_start_ms: mainStartMs,
        ui_committed_ms: committedMs,
        ui_hidden_at_commit: hiddenAtCommit ? 1 : 0,
        ui_ready_ms: readyMs,
        ui_ready_unix_ms: performance.timeOrigin + readyMs,
      }).catch(() => {
        // non-fatal: older backends do not have this binding
      });
    }, 0);
  });
}
