import { eventbus } from '@/events/eventbus';
import type { SessionOptions } from '@omniviewdev/runtime/models';
import type { Value, ResourceReference, AccessRoute } from '@omniviewdev/runtime';

type OnCreateSessionOpts = {
  plugin: string;
  connection: string;
  opts: SessionOptions;
  icon?: string;
  label?: string;
  /** Replace an existing session without changing tab position or focus. */
  replaceSessionId?: string;
};

type OnCreateLogSessionOpts = {
  plugin: string;
  connection: string;
  resourceKey: string;
  resourceID: string;
  resourceData: Value;
  reference?: ResourceReference;
  route?: AccessRoute;
  target?: string;
  follow?: boolean;
  tailLines?: number;
  icon?: string;
  label?: string;
  params?: Record<string, string>;
};

type OnSessionClosedOpts = {
  id: string;
};

type BottomDrawerEvents = {
  onResize: (height: number) => void;
  onResizeHandler: (height: number) => void;
  onResizeReset: () => void;
  onFullscreen: () => void;
  onMinimize: () => void;
  /** Fired when the drawer's committed height changes (not on every drag frame; see onResizeHandler). */
  onHeightChange: (height: number) => void;
  /** Fired when a new tab is created so the drawer can auto-expand. */
  onTabCreated: () => void;
  onCreateSession: (opts: OnCreateSessionOpts) => void;
  onCreateLogSession: (opts: OnCreateLogSessionOpts) => void;
  onSessionClosed: (opts: OnSessionClosedOpts) => void;
};

export const bottomDrawerChannel = eventbus<BottomDrawerEvents>();

// Module state is per window (each window is its own document), like the drawer it mirrors.
let bottomDrawerHeight = 32;

/** The bottom drawer's last committed height, for panels that mount after it. */
export function getBottomDrawerHeight(): number {
  return bottomDrawerHeight;
}

/** Records the drawer's committed height and notifies panels that size against it. */
export function setBottomDrawerHeight(height: number): void {
  if (height === bottomDrawerHeight) {
    return;
  }

  bottomDrawerHeight = height;
  bottomDrawerChannel.emit('onHeightChange', height);
}
