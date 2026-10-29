import { useEffect, useLayoutEffect, useRef } from 'react';
import { Events } from '@omniviewdev/runtime/runtime';
import { currentWindow } from './identity';

const DELIVER_EVENT = 'windows/tab/deliver';
const DELIVERED_EVENT = 'windows/tab/delivered';
const DELIVERY_TIMEOUT_MS = 2000;

type DeliverEventData = {
  deliveryId: string;
  targetWindow: string;
  dragType: string;
  payloadJson: string;
};

type DeliveredEventData = { deliveryId: string; accepted: boolean };

/**
 * Hands a serialized tab to another window (menu "Move to window"). Resolves
 * once the target window has taken the tab; the caller removes its own copy
 * only after that, so a tab is never lost when the target is gone.
 */
export async function deliverTabToWindow(targetWindow: string, dragType: string, payload: unknown): Promise<void> {
  const deliveryId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      off();
      reject(new Error(`window "${targetWindow}" did not take the tab within ${DELIVERY_TIMEOUT_MS}ms`));
    }, DELIVERY_TIMEOUT_MS);
    const off = Events.On(DELIVERED_EVENT, (event) => {
      const data = event.data as DeliveredEventData;
      if (data.deliveryId !== deliveryId) {
        return;
      }

      clearTimeout(timeout);
      off();
      if (data.accepted) {
        resolve();
      } else {
        reject(new Error(`window "${targetWindow}" refused the tab`));
      }
    });
    const data: DeliverEventData = { deliveryId, targetWindow, dragType, payloadJson: JSON.stringify(payload) };
    Events.Emit(DELIVER_EVENT, data).catch((error: unknown) => {
      clearTimeout(timeout);
      off();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/**
 * Receives tabs of `dragType` delivered to this window. The handler returns
 * whether it took the tab.
 */
export function useTabDeliveries(dragType: string, takeTab: (payload: unknown) => boolean): void {
  const takeTabRef = useRef(takeTab);
  useLayoutEffect(() => {
    takeTabRef.current = takeTab;
  }, [takeTab]);

  useEffect(() => Events.On(DELIVER_EVENT, (event) => {
    const data = event.data as DeliverEventData;
    if (data.targetWindow !== currentWindow.name || data.dragType !== dragType) {
      return;
    }

    let accepted = false;
    try {
      accepted = takeTabRef.current(JSON.parse(data.payloadJson));
    } catch (error) {
      console.error('[windows] failed to take delivered tab', error);
    }

    const reply: DeliveredEventData = { deliveryId: data.deliveryId, accepted };
    void Events.Emit(DELIVERED_EVENT, reply);
  }), [dragType]);
}
