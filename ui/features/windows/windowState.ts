import { WindowClient } from '@omniviewdev/runtime/api';
import { currentWindow } from './identity';

export type WindowStateSlot = 'pages' | 'drawer';

const SAVE_DEBOUNCE_MS = 400;

let initialSlots: Readonly<Partial<Record<string, string>>> = {};
const pendingSaves = new Map<WindowStateSlot, { json: string; timer: ReturnType<typeof setTimeout> }>();

/**
 * Loads this window's saved slots once, before React renders, so that the
 * first render already shows the restored tabs instead of a default layout.
 */
export async function loadInitialWindowState(): Promise<void> {
  initialSlots = Object.freeze({ ...(await WindowClient.GetState(currentWindow.name)) });
}

/**
 * Returns the slot as loaded at boot, parsed and validated by its owner.
 * A slot that fails validation is reported and treated as absent.
 */
export function readInitialSlot<T>(slot: WindowStateSlot, parse: (value: unknown) => T): T | null {
  const json = initialSlots[slot];
  if (!json) {
    return null;
  }

  try {
    return parse(JSON.parse(json));
  } catch (error) {
    console.error(`[windows] discarding invalid saved "${slot}" state`, error);
    return null;
  }
}

async function writeSlot(slot: WindowStateSlot, json: string): Promise<void> {
  return WindowClient.SaveState(currentWindow.name, slot, json).catch((error: unknown) => {
    console.error(`[windows] SaveState(${slot}) failed`, error);
  });
}

export function saveSlot(slot: WindowStateSlot, value: unknown): void {
  const json = JSON.stringify(value);
  const pending = pendingSaves.get(slot);
  if (pending) {
    clearTimeout(pending.timer);
  }

  const timer = setTimeout(() => {
    pendingSaves.delete(slot);
    void writeSlot(slot, json);
  }, SAVE_DEBOUNCE_MS);
  pendingSaves.set(slot, { json, timer });
}

/** Writes every debounced slot now; used when the window is about to close. */
export function flushPendingSlots(): void {
  for (const [slot, pending] of pendingSaves) {
    clearTimeout(pending.timer);
    void writeSlot(slot, pending.json);
  }

  pendingSaves.clear();
}
