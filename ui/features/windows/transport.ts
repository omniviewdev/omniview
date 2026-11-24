import type {
  RemoteTabDragEvent,
  RemoteTabDropResult,
  TabDragPayload,
  TabDragPointer,
  TabDragTransport,
} from '@omniviewdev/base-ui';
import { WindowClient } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import { hasTerminalSessionToOffer, offerTerminalSession } from '@/providers/BottomDrawer/terminalHandoff';
import { DRAWER_TAB_DRAG_TYPE } from './dragTypes';
import { currentWindow } from './identity';

/** Hover and drop events carry the pointer in the target window's client space. */
type DragEventData = {
  sessionId: string;
  targetWindow?: string;
  payload?: string;
  clientX?: number;
  clientY?: number;
};

function parsePayload(payload: DragEventData['payload']): TabDragPayload {
  if (!payload) {
    throw new Error('[windows] drag event has no payload');
  }

  return JSON.parse(payload) as TabDragPayload;
}

function isForThisWindow(data: DragEventData): boolean {
  return data.targetWindow === currentWindow.name;
}

type ClientPoint = { clientX: number; clientY: number };

/**
 * Runs WindowService calls for one drag session strictly in order. Pointer
 * moves arrive far faster than IPC round trips, so pending moves collapse to
 * the latest point; begin, drop and cancel are never dropped or reordered.
 */
class SerialDragChannel {
  private tail: Promise<unknown> = Promise.resolve();
  private pendingMovePoint: ClientPoint | null = null;
  private moveScheduled = false;

  constructor(
    private readonly sessionId: string,
    /** The terminal session that the drag offers when it is dropped; null when it carries none. */
    readonly tabToOffer: OfferableTab | null,
  ) {}

  async enqueue<T>(call: () => Promise<T>): Promise<T> {
    const result = this.tail.then(call);
    this.tail = result.catch((error: unknown) => {
      console.error(`[windows] drag session ${this.sessionId} call failed`, error);
    });
    return result;
  }

  enqueueMove(point: ClientPoint): void {
    this.pendingMovePoint = point;
    if (this.moveScheduled) {
      return;
    }

    this.moveScheduled = true;
    void this.enqueue(async () => {
      this.moveScheduled = false;
      const latestPoint = this.pendingMovePoint;
      this.pendingMovePoint = null;
      if (latestPoint) {
        await WindowClient.MoveDrag(this.sessionId, latestPoint.clientX, latestPoint.clientY);
      }
    });
  }
}

type OfferableTab = Parameters<typeof offerTerminalSession>[0];

/**
 * A drawer tab that is a terminal carries its session, and a window cannot
 * attach a session that another window holds (docs/ui-next/status/T2c-go.md).
 * Returns the tab to offer when it is dropped, or null when the payload is not
 * a drawer tab that has a session to offer.
 */
function tabWithSessionToOffer(payload: TabDragPayload): OfferableTab | null {
  const drawerTab = payload.tab.payload as { variant?: unknown; properties?: Record<string, unknown> } | undefined;
  if (payload.dragType !== DRAWER_TAB_DRAG_TYPE || typeof drawerTab?.variant !== 'string') {
    return null;
  }

  const tab = { id: payload.tab.id, variant: drawerTab.variant, properties: drawerTab.properties };
  return hasTerminalSessionToOffer(tab) ? tab : null;
}

/**
 * TabDragTransport over the Go WindowService. The source window streams the
 * pointer in its own client coordinates (webview screen coordinates are not
 * global on WebKitGTK); Go maps it through native window bounds, hit-tests
 * every window's viewport and forwards hover and drop events to the window
 * under the pointer, which answers with RespondDrop.
 */
export function createWailsTabDragTransport(): TabDragTransport {
  const channels = new Map<string, SerialDragChannel>();

  return {
    begin(sessionId, payload, pointer: TabDragPointer) {
      const channel = new SerialDragChannel(sessionId, tabWithSessionToOffer(payload));
      channels.set(sessionId, channel);
      void channel.enqueue(async () => {
        await WindowClient.BeginDrag({
          sessionId,
          sourceWindow: currentWindow.name,
          dragType: payload.dragType,
          payload: JSON.stringify(payload),
        });
      });
      channel.enqueueMove(pointer);
    },

    move(sessionId, pointer) {
      channels.get(sessionId)?.enqueueMove(pointer);
    },

    async drop(sessionId, pointer): Promise<RemoteTabDropResult> {
      const channel = channels.get(sessionId);
      if (!channel) {
        throw new Error(`[windows] no drag channel for session ${sessionId}`);
      }

      channels.delete(sessionId);
      const result = await channel.enqueue(async () => {
        // The target attaches the session as soon as EndDrag forwards the drop to it, and an offer stays open for a
        // minute: the offer is made here, in line, and not as the drag begins, which can be long before the drop.
        if (channel.tabToOffer) {
          try {
            await offerTerminalSession(channel.tabToOffer);
          } catch (error) {
            console.warn('[windows] could not offer the session of a terminal that is dropped; the drag is cancelled', channel.tabToOffer.id, error);
            await WindowClient.CancelDrag(sessionId).catch((cancelError: unknown) => {
              console.error('[windows] CancelDrag failed', cancelError);
            });
            return null;
          }
        }

        return WindowClient.EndDrag(sessionId, pointer.clientX, pointer.clientY);
      });
      return result?.accepted ? { targetInstanceId: result.targetInstanceId } : null;
    },

    cancel(sessionId) {
      const channel = channels.get(sessionId);
      if (!channel) {
        return;
      }

      channels.delete(sessionId);
      void channel.enqueue(async () => WindowClient.CancelDrag(sessionId));
    },

    subscribe(handler: (event: RemoteTabDragEvent) => void) {
      const offHover = Events.On('windows/drag/hover', (event) => {
        const data = event.data as DragEventData;
        if (!isForThisWindow(data)) {
          return;
        }

        handler({
          type: 'hover',
          sessionId: data.sessionId,
          payload: parsePayload(data.payload),
          clientX: data.clientX ?? 0,
          clientY: data.clientY ?? 0,
        });
      });
      const offLeave = Events.On('windows/drag/leave', (event) => {
        const data = event.data as DragEventData;
        if (!isForThisWindow(data)) {
          return;
        }

        handler({ type: 'leave', sessionId: data.sessionId });
      });
      const offDrop = Events.On('windows/drag/drop', (event) => {
        const data = event.data as DragEventData;
        if (!isForThisWindow(data)) {
          return;
        }

        handler({
          type: 'drop',
          sessionId: data.sessionId,
          payload: parsePayload(data.payload),
          clientX: data.clientX ?? 0,
          clientY: data.clientY ?? 0,
          respond: (result) => {
            WindowClient.RespondDrop(data.sessionId, result !== null, result?.targetInstanceId ?? '')
              .catch((error: unknown) => {
                console.error('[windows] RespondDrop failed', error); 
              });
          },
        });
      });
      const offEnd = Events.On('windows/drag/end', (event) => {
        const data = event.data as DragEventData;
        handler({ type: 'end', sessionId: data.sessionId });
      });
      return () => {
        offHover();
        offLeave();
        offDrop();
        offEnd();
      };
    },
  };
}
