import { useEffect, useState } from 'react';
import { WindowClient } from '@omniviewdev/runtime/api';
import { window as windowModels } from '@omniviewdev/runtime/models';
import { Events } from '@omniviewdev/runtime/runtime';
import { currentWindow, type WindowKind } from './identity';
import type { WindowStateSlot } from './windowState';

export type WindowInfo = { name: string; kind: WindowKind; focused: boolean };

/** Pointer position in this window's client coordinates, e.g. a tear-off release point. */
export type WindowClientPoint = { clientX: number; clientY: number };

export type OpenWindowOptions = {
  kind: Exclude<WindowKind, 'settings'>;
  /** Slot values (already JSON-serializable objects) the new window loads at boot. */
  slots: Partial<Record<WindowStateSlot, unknown>>;
  /** Release point of a tear-off in this window; the new window opens under it. */
  pointer?: WindowClientPoint;
};

export async function openWindow({ kind, slots, pointer }: OpenWindowOptions): Promise<string> {
  const initialState: Record<string, string> = {};
  for (const [slot, value] of Object.entries(slots)) {
    initialState[slot] = JSON.stringify(value);
  }

  return WindowClient.Open({
    kind: kind === 'panel' ? windowModels.Kind.KindPanel : windowModels.Kind.KindWorkspace,
    initialState,
    anchorWindow: currentWindow.name,
    clientX: pointer?.clientX ?? 0,
    clientY: pointer?.clientY ?? 0,
    hasPosition: pointer !== undefined,
    width: 0,
    height: 0,
  });
}

/** Moves this window so it sits under the pointer the way a torn-off window opens. */
export async function moveCurrentWindowToPointer(pointer: WindowClientPoint): Promise<void> {
  return WindowClient.MoveToPointer(currentWindow.name, pointer.clientX, pointer.clientY);
}

type RawWindowInfo = { name: string; kind: string; focused: boolean };

function toWindowInfo(raw: RawWindowInfo): WindowInfo {
  if (raw.kind !== 'workspace' && raw.kind !== 'panel' && raw.kind !== 'settings') {
    throw new Error(`Unsupported window kind: ${raw.kind}`);
  }

  return { name: raw.name, kind: raw.kind, focused: raw.focused };
}

/** Live list of open windows, for "Move to window" menus. */
export function useWindowsList(): WindowInfo[] {
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  useEffect(() => {
    let disposed = false;
    WindowClient.List()
      .then((list: RawWindowInfo[]) => {
        if (!disposed) {
          setWindows(list.map(toWindowInfo));
        }
      })
      .catch((error: unknown) => {
        console.error('[windows] List failed', error); 
      });
    const off = Events.On('windows/changed', (event) => {
      const data = event.data as { windows: RawWindowInfo[] };
      setWindows(data.windows.map(toWindowInfo));
    });
    return () => {
      disposed = true;
      off();
    };
  }, []);
  return windows;
}

export type ClosedWindowEvent = { name: string; kind: WindowKind; states: Partial<Record<WindowStateSlot, string>> };

export function onWindowClosed(handler: (event: ClosedWindowEvent) => void): () => void {
  return Events.On('windows/closed', (event) => {
    handler(event.data as ClosedWindowEvent); 
  });
}
