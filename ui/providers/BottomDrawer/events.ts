import { eventbus } from '@/events/eventbus';
import { type exec } from '@omniviewdev/runtime/models';

type OnCreateSessionOpts = {
  plugin: string;
  connection: string;
  opts: exec.SessionOptions;
  icon?: string;
  label?: string;
};

type OnCreateLogSessionOpts = {
  plugin: string;
  connection: string;
  resourceKey: string;
  resourceID: string;
  resourceData: Record<string, any>;
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
  onCreateSession: (opts: OnCreateSessionOpts) => void;
  onCreateLogSession: (opts: OnCreateLogSessionOpts) => void;
  onSessionClosed: (opts: OnSessionClosedOpts) => void;
};

export const bottomDrawerChannel = eventbus<BottomDrawerEvents>();
