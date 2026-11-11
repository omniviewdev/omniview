import { classifyFrontendError, recordFrontendSpan, type ErrorClass } from '@omniviewdev/runtime';
import { PluginTimeoutError } from './errors';

export type PluginLoadSource = 'builtin' | 'dev' | 'external';
export type PluginLoadPhase = 'activate' | 'import' | 'validate' | 'register';

/** Maps a load descriptor or options object to the closed `source` vocabulary. */
export function pluginLoadSource(opts: { readonly dev?: boolean; readonly origin?: string }): PluginLoadSource {
  if (opts.origin === 'builtin') {
    return 'builtin';
  }

  return opts.dev ? 'dev' : 'external';
}

function classifyLoadError(error: unknown): ErrorClass {
  return error instanceof PluginTimeoutError ? 'timeout' : classifyFrontendError(error);
}

/**
 * One `frontend.plugin.load` span. Records only closed-vocabulary attributes:
 * never the error message, import URL or module contents.
 */
export class PluginLoadTelemetry {
  private phase: PluginLoadPhase = 'activate';
  private open = true;
  private readonly start = Date.now();

  constructor(
    private readonly pluginId: string,
    private source: PluginLoadSource,
    private readonly retry?: number,
  ) {}

  setSource(source: PluginLoadSource): void {
    this.source = source;
  }

  enter(phase: PluginLoadPhase): void {
    this.phase = phase;
  }

  success(): void {
    this.finish('success', undefined, false);
  }

  fail(error: unknown): void {
    this.finish('failure', error, error instanceof PluginTimeoutError);
  }

  /** Ends an attempt that was superseded (stale generation, unload, reset). */
  cancel(): void {
    this.finish('canceled', undefined, false);
  }

  private finish(outcome: 'success' | 'failure' | 'canceled', error: unknown, timedOut: boolean): void {
    if (!this.open) {
      return;
    }

    this.open = false;
    let errorClass: ErrorClass | undefined;
    if (outcome === 'failure') {
      errorClass = classifyLoadError(error);
      if (errorClass === 'canceled') {
        outcome = 'canceled';
      }
    }

    recordFrontendSpan('frontend.plugin.load', {
      plugin_id: this.pluginId,
      source: this.source,
      phase: this.phase,
      timed_out: timedOut,
      ...(this.retry === undefined ? {} : { retry: this.retry }),
      outcome,
      ...(errorClass ? { error_class: errorClass } : {}),
    }, this.start, Date.now(), outcome === 'failure');
  }
}

/** Records one `frontend.plugin.import` span, including timeouts and late settlement after a timeout. */
export function recordPluginImport(
  pluginId: string,
  source: PluginLoadSource,
  start: number,
  result: { readonly ok: true } | { readonly ok: false; readonly error: unknown },
  flags: { readonly timedOut: boolean; readonly lateSettle: boolean },
): void {
  let errorClass: ErrorClass | undefined;
  let outcome: 'success' | 'failure' | 'canceled' = 'success';
  if (!result.ok) {
    errorClass = classifyLoadError(result.error);
    outcome = errorClass === 'canceled' ? 'canceled' : 'failure';
  }

  recordFrontendSpan('frontend.plugin.import', {
    plugin_id: pluginId,
    source,
    timed_out: flags.timedOut,
    late_settle: flags.lateSettle,
    outcome,
    ...(errorClass ? { error_class: errorClass } : {}),
  }, start, Date.now(), outcome === 'failure');
}
