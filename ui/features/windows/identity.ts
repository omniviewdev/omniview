import { WindowClient } from '@omniviewdev/runtime/api';
import { window as windowModels } from '@omniviewdev/runtime/models';
import { Window } from '@omniviewdev/runtime/runtime';

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
  const name = await Window.Name();
  const info = (await WindowClient.List()).find((window) => window.name === name);
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
}
