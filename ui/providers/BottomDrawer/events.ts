import { eventbus } from '@/events/eventbus';
import { type exec } from '@omniviewdev/runtime/models';

type OnCreateSessionOpts = {
  plugin: string;
  connection: string;
  opts: exec.SessionOptions;
  icon?: string;
  label?: string;
};

type OnSessionClosedOpts = {
  id: string;
};

type BottomDrawerEvents = {
  onResize: (height: number) => void;
  onFullscreen: () => void;
  onMinimize: () => void;
  onCreateSession: (opts: OnCreateSessionOpts) => void;
  onSessionClosed: (opts: OnSessionClosedOpts) => void;
};

export const bottomDrawerChannel = eventbus<BottomDrawerEvents>();
