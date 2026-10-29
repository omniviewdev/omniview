export {
  currentWindow,
  MAIN_WINDOW_NAME,
  resolveCurrentWindow,
  type CurrentWindow,
  type WindowKind,
} from './identity';
export {
  loadInitialWindowState,
  readInitialSlot,
  saveSlot,
  flushPendingSlots,
  type WindowStateSlot,
} from './windowState';
export {
  openWindow,
  moveCurrentWindowToPointer,
  useWindowsList,
  onWindowClosed,
  type OpenWindowOptions,
  type WindowClientPoint,
  type WindowInfo,
  type ClosedWindowEvent,
} from './windows';
export { deliverTabToWindow, useTabDeliveries } from './delivery';
export { WindowTabDragProvider } from './WindowTabDragProvider';

export const PAGE_TAB_DRAG_TYPE = 'omniview/page-tab';
export const DRAWER_TAB_DRAG_TYPE = 'omniview/drawer-tab';
