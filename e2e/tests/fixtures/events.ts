import { randomUUID } from 'node:crypto';
import { expect, type BrowserContext, type Page } from '@playwright/test';

/** Observe the loaded dispatcher passively; emit only through the real backend. */
export async function assertBackendEventDelivery(sender: Page, context: BrowserContext, browserURL: string): Promise<void> {
  const receiver = await context.newPage();
  const session = await context.newCDPSession(receiver);
  try {
    const socketReady = receiver.waitForEvent('websocket', socket => new URL(socket.url()).pathname === '/wails/events');
    const handshake = Promise.withResolvers<number>();
    let eventsRequestID: string | undefined;
    session.on('Network.webSocketCreated', ({ requestId, url }) => {
      if (new URL(url).pathname === '/wails/events') {
        eventsRequestID = requestId;
      } 
    });
    session.on('Network.webSocketHandshakeResponseReceived', ({ requestId, response }) => {
      if (requestId === eventsRequestID) {
        handshake.resolve(response.status);
      } 
    });
    await session.send('Network.enable');
    await receiver.goto(browserURL);
    const socket = await socketReady;
    expect(await handshake.promise).toBe(101);
    const event = `omniview:e2e/${randomUUID()}`;
    const marker = randomUUID();
    await expect.poll(async () => receiver.evaluate(() => typeof window._wails?.dispatchWailsEvent)).toBe('function');
    await receiver.evaluate(event => {
      const runtime = window._wails;
      if (!runtime?.dispatchWailsEvent) {
        throw new Error('Actual app dispatcher is unavailable');
      }

      const original = runtime.dispatchWailsEvent;
      const { promise, resolve } = Promise.withResolvers<unknown>();
      window.e2eEvent = promise;
      const observe = function (this: unknown, message: unknown): unknown {
        const result = original.call(this, message);
        if (message && typeof message === 'object' && 'name' in message && message.name === event && 'data' in message) {
          resolve(message.data);
        }

        return result;
      };

      runtime.dispatchWailsEvent = observe;
      window.e2eRestoreEventDispatcher = () => {
        if (runtime.dispatchWailsEvent === observe) {
          runtime.dispatchWailsEvent = original;
        }

        delete window.e2eRestoreEventDispatcher;
        delete window.e2eEvent;
      };
    }, event);
    const frame = socket.waitForEvent('framereceived', { predicate: message => String(message.payload).includes(marker) });
    await sender.evaluate(async ({ event, marker }) => {
      const clientID = window._wails?.clientId;
      if (!clientID) {
        throw new Error('Actual sender runtime client ID is unavailable');
      }

      const response = await fetch('/wails/runtime', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-wails-client-id': clientID }, body: JSON.stringify({ object: 3, method: 0, args: { name: event, data: { marker } } }) });
      if (!response.ok) {
        throw new Error(`Actual backend event emission failed (${response.status})`);
      }
    }, { event, marker });
    await frame;
    expect(await receiver.evaluate(async () => window.e2eEvent)).toEqual({ marker });
  } finally {
    try {
      if (!receiver.isClosed()) {
        await receiver.evaluate(() => window.e2eRestoreEventDispatcher?.());
      } 
    } finally {
      await session.detach(); await receiver.close(); 
    }
  }
}

type EventWindow = Window & {
  e2eEvent?: Promise<unknown>;
  e2eRestoreEventDispatcher?: () => void;
  _wails?: { clientId?: string; dispatchWailsEvent?: (message: unknown) => unknown };
};
declare const window: EventWindow;
