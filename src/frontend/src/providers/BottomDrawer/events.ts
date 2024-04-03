import { eventbus } from '@/events/eventbus';

type BottomDrawerEvents = {
  onResize: (height: number) => void;
  onFullscreen: () => void;
  onMinimize: () => void;
};

export const bottomDrawerChannel = eventbus<BottomDrawerEvents>();
