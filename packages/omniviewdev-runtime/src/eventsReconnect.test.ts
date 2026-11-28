import { describe, expect, it, vi } from 'vitest';
import { createEventsReconnect } from './eventsReconnect';

// The page's events connection (server mode): a WebSocket at /wails/events that the runtime's script opens and, when it drops, opens again after a second, with nothing replayed. The signal tells when it OPENS, and it must do so
// without changing anything for the page's other code: the sockets of everything else in the page (the plugins' own among them) are made by the native constructor as ever.

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeSocket[] = [];
  readonly url: string;
  readonly listened: string[] = [];
  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeSocket.instances.push(this);
  }

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    this.listened.push(type);
    super.addEventListener(type, listener, options);
  }
}

function scopeOf() {
  FakeSocket.instances.length = 0;
  return { WebSocket: FakeSocket as unknown as typeof WebSocket, location: { href: 'http://127.0.0.1:9245/' } };
}

const open = (socket: unknown): void => {
  (socket as FakeSocket).dispatchEvent(new Event('open'));
};

describe('the events connection of the page', () => {
  it('withdraws authority on disconnect without waiting for the next open', () => {
    const scope = scopeOf();
    const changes: boolean[] = [];
    const unsubscribe = createEventsReconnect(scope).observeTransport(connected => changes.push(connected));
    const first = new scope.WebSocket('ws://localhost/wails/events');
    const second = new scope.WebSocket('ws://localhost/wails/events');
    open(first);
    open(second);
    first.dispatchEvent(new Event('close'));
    second.dispatchEvent(new Event('close'));
    expect(changes).toEqual([false, true, true, false]);
    unsubscribe();
  });

  it('tells its listeners each time an events socket opens, and nothing for any other socket', () => {
    const scope = scopeOf();
    const heard = vi.fn();
    createEventsReconnect(scope).subscribe(heard);
    open(new scope.WebSocket('ws://127.0.0.1:9245/wails/events?clientId=abc'));
    expect(heard).toHaveBeenCalledTimes(1);
    open(new scope.WebSocket('ws://127.0.0.1:9245/wails/events?clientId=abc'));
    expect(heard).toHaveBeenCalledTimes(2);
    open(new scope.WebSocket('ws://127.0.0.1:9245/some/other/stream'));
    open(new scope.WebSocket(new URL('ws://127.0.0.1:9245/wails/events-not')));
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('hears an events socket once: the listener it adds goes after it has run', () => {
    const scope = scopeOf();
    const heard = vi.fn();
    createEventsReconnect(scope).subscribe(heard);
    const socket = new scope.WebSocket('ws://127.0.0.1:9245/wails/events');
    open(socket);
    open(socket);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('wraps the constructor while someone listens, once, and gives the native one back when the last listener goes', () => {
    const scope = scopeOf();
    const native = scope.WebSocket;
    const signal = createEventsReconnect(scope);
    const heard = vi.fn();
    const stopFirst = signal.subscribe(heard);
    const wrapped = scope.WebSocket;
    expect(wrapped).not.toBe(native);
    const stopSecond = signal.subscribe(vi.fn());
    expect(scope.WebSocket).toBe(wrapped);
    stopFirst();
    expect(scope.WebSocket).toBe(wrapped);
    stopSecond();
    expect(scope.WebSocket).toBe(native);
    open(new native('ws://127.0.0.1:9245/wails/events'));
    expect(heard).not.toHaveBeenCalled();
  });

  it('does not restore over a constructor that someone else has put in its place', () => {
    const scope = scopeOf();
    const stop = createEventsReconnect(scope).subscribe(vi.fn());
    const theirs = class extends FakeSocket {} as unknown as typeof WebSocket;
    scope.WebSocket = theirs;
    stop();
    expect(scope.WebSocket).toBe(theirs);
  });

  it('listens again after someone else replaced the constructor: unsubscribe, subscribe again, a new events socket is heard', () => {
    const scope = scopeOf();
    const signal = createEventsReconnect(scope);
    const stop = signal.subscribe(vi.fn());
    scope.WebSocket = class extends FakeSocket {} as unknown as typeof WebSocket;
    stop();
    const heard = vi.fn();
    signal.subscribe(heard);
    open(new scope.WebSocket('ws://127.0.0.1:9245/wails/events'));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('tells once when the constructor is wrapped twice: something wrapped ours, and the next subscriber wrapped theirs', () => {
    const scope = scopeOf();
    const signal = createEventsReconnect(scope);
    const stop = signal.subscribe(vi.fn());
    scope.WebSocket = new Proxy(scope.WebSocket, {});
    stop();
    const heard = vi.fn();
    signal.subscribe(heard);
    const made = new scope.WebSocket('ws://127.0.0.1:9245/wails/events') as unknown as FakeSocket;
    open(made);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(made.listened).toEqual(['open']);
  });

  it('lets two signals on the same scope each hear the events socket', () => {
    const scope = scopeOf();
    const first = createEventsReconnect(scope);
    const second = createEventsReconnect(scope);
    const heardByFirst = vi.fn();
    const heardBySecond = vi.fn();
    first.subscribe(heardByFirst);
    second.subscribe(heardBySecond);
    open(new scope.WebSocket('ws://127.0.0.1:9245/wails/events'));
    expect(heardByFirst).toHaveBeenCalledTimes(1);
    expect(heardBySecond).toHaveBeenCalledTimes(1);
  });

  it('makes the real instance: the native prototype, instanceof for both constructors, the statics, and a subclass of it', () => {
    const scope = scopeOf();
    const native = scope.WebSocket;
    createEventsReconnect(scope).subscribe(vi.fn());
    const wrapped = scope.WebSocket;
    const made = new wrapped('ws://127.0.0.1:9245/wails/events');
    expect(Object.getPrototypeOf(made)).toBe(native.prototype);
    expect(made).toBeInstanceOf(native);
    expect(made).toBeInstanceOf(wrapped);
    expect(wrapped.prototype).toBe(native.prototype);
    expect([wrapped.CONNECTING, wrapped.OPEN, wrapped.CLOSING, wrapped.CLOSED]).toEqual([0, 1, 2, 3]);
    class Mine extends wrapped {
      readonly mine = true;
    }
    const sub = new Mine('ws://127.0.0.1:9245/some/stream');
    expect(sub).toBeInstanceOf(Mine);
    expect(sub).toBeInstanceOf(native);
    expect(sub.mine).toBe(true);
  });

  it('adds one open listener to an events socket and none to any other socket, which is the real instance, untouched', () => {
    const scope = scopeOf();
    createEventsReconnect(scope).subscribe(vi.fn());
    const events = new scope.WebSocket('ws://127.0.0.1:9245/wails/events?clientId=x') as unknown as FakeSocket;
    const other = new scope.WebSocket('ws://127.0.0.1:9245/some/stream') as unknown as FakeSocket;
    expect(events.listened).toEqual(['open']);
    expect(other.listened).toEqual([]);
    expect(FakeSocket.instances).toEqual([events, other]);
  });

  it('does nothing where there is no WebSocket to wrap (a native window has no events socket)', () => {
    const signal = createEventsReconnect({ WebSocket: undefined, location: undefined });
    const heard = vi.fn();
    const stop = signal.subscribe(heard);
    stop();
    expect(heard).not.toHaveBeenCalled();
  });
});
