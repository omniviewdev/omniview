import { eventbus } from '@/events/eventbus';
import { type exec } from '@api/models';

type OnCreateSessionOpts = {
  plugin: string;
  connection: string;
  opts: exec.SessionOptions;
  icon?: string;
  label?: string;
};

type BottomDrawerEvents = {
  onResize: (height: number) => void;
  onFullscreen: () => void;
  onMinimize: () => void;
  onCreateSession: (opts: OnCreateSessionOpts) => void;
};

export const bottomDrawerChannel = eventbus<BottomDrawerEvents>();
