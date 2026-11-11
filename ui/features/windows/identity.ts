import { WindowClient } from '@omniviewdev/runtime/api';
import { window as windowModels } from '@omniviewdev/runtime/models';
import { Window } from '@omniviewdev/runtime/runtime';
import { classifyFrontendError, recordFrontendSpan } from '@omniviewdev/runtime';

export type WindowKind = 'workspace' | 'panel' | 'settings';

export type CurrentWindow = Readonly<{
  name: string;
  kind: WindowKind;
  isMain: boolean;
}>;

export const MAIN_WINDOW_NAME = 'main';

const resolvedWindow: { name: string; kind: WindowKind; isMain: boolean } = {
  name: MAIN_WINDOW_NAME,
  kind: 'workspace',
  isMain: true,
};

/** This document's native window. Valid after `resolveCurrentWindow()`, which boot awaits before rendering. */
export const currentWindow: CurrentWindow = resolvedWindow;

/**
 * Asks Wails which native window hosts this document. The identity cannot
 * come from the URL: a reload of a secondary window loads the start URL
 * without its query and would turn the window into a second "main".
 */
export async function resolveCurrentWindow(): Promise<void> {
  const start = Date.now();
  try {
    const name = await Window.Name();
    const windows = await WindowClient.List();
    const info = windows.find((window) => window.name === name);
    if (!info) {
      throw new Error(`window "${name}" is not registered with the window service`);
    }

    resolvedWindow.name = name;
    if (info.kind !== windowModels.Kind.KindWorkspace && info.kind !== windowModels.Kind.KindPanel && info.kind !== windowModels.Kind.KindSettings) {
      throw new Error(`window "${name}" has an unsupported kind`);
    }

    resolvedWindow.kind = info.kind;
    resolvedWindow.isMain = name === MAIN_WINDOW_NAME;
    Object.freeze(resolvedWindow);
    recordFrontendSpan('frontend.window.resolve', {
      window_kind: telemetryWindowKind(),
      fallback: false,
      window_count: Math.min(windows.length, 64),
      outcome: 'success',
    }, start, Date.now(), false);
  } catch (error) {
    // Window identity failed before a kind was known, so no window_kind is attached.
    recordFrontendSpan('frontend.window.resolve', {
      outcome: 'failure',
      error_class: classifyFrontendError(error),
    }, start, Date.now(), true);
    throw error;
  }
}

/** Closed `window_kind` span value for this window; never the window name. */
export function telemetryWindowKind(): 'main' | 'detached' | 'other' {
  if (resolvedWindow.kind === 'settings') {
    return 'other';
  }

  return resolvedWindow.isMain ? 'main' : 'detached';
}
