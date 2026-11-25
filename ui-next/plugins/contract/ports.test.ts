import type { NetworkerClient } from '@omniviewdev/runtime/api';
import type { ResourceReference, Value } from '@omniviewdev/runtime/ui/v1';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ContextV1, LogTargetV1, PaletteCommandContextV1, PanelHostV1, PortForwardErrorCodeV1, PortForwardErrorV1, PortForwardRequestV1, PortForwardSessionV1 } from './v1';

// The ports member of the panel handle (PF1, a minor addition to version 1: the rule is at the head of `v1.ts`). What this file proves is TYPES, so the proof is the compiler's: `tsc -p tsconfig.test.json` (CI's typecheck)
// fails on any line below when the member stops being additive, stops being optional, stops being the runtime's typed start less what the host fills in, or changes what a plugin is answered and refused with. Vitest does not
// typecheck, so the run time half of each test only names what the compiler checked; the controls at the end show the check can fail (an unused `@ts-expect-error` is itself an error). What the host does with a request is
// `host/portForward.test.ts`.

type Ports = NonNullable<PanelHostV1['ports']>;
type Target = NetworkerClient.ResourcePortForwardTarget;

/** The members a type cannot do without. */
type RequiredKeys<T> = { [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K }[keyof T];

describe('the member is additive', () => {
  it('a handle written before it (the Logs member and nothing else) is still the contract\'s `PanelHostV1`', () => {
    type Before = { readonly logs: PanelHostV1['logs'] };
    expectTypeOf<Before>().toExtend<PanelHostV1>();
    const before = (handle: Before): PanelHostV1 => handle;
    expect(typeof before).toBe('function');
  });

  it('a context with no handle, and a command\'s context with none, are still the contract\'s: nothing that existed is required of them', () => {
    expectTypeOf<{ readonly plugin: string; readonly route: ContextV1['route'] }>().toExtend<ContextV1>();
    expectTypeOf<{ readonly plugin: string }>().toExtend<PaletteCommandContextV1>();
    expectTypeOf<ContextV1['panel']>().toEqualTypeOf<PanelHostV1 | undefined>();
    expectTypeOf<PaletteCommandContextV1['panel']>().toEqualTypeOf<PanelHostV1 | undefined>();
  });

  it('the Logs member is what it was', () => {
    expectTypeOf<PanelHostV1['logs']['open']>().parameters.toEqualTypeOf<[target: LogTargetV1]>();
  });
});

describe('the member is optional: a host that lacks it leaves it `undefined`, and a plugin tests for it', () => {
  it('is the member or nothing', () => {
    expectTypeOf<PanelHostV1['ports']>().toEqualTypeOf<Ports | undefined>();
    expectTypeOf<RequiredKeys<PanelHostV1>>().toEqualTypeOf<'logs'>();
  });

  it('is reached as `ctx.panel?.ports?.forward`, which is absent whenever the handle or the member is', () => {
    const forwarder = (panel: PanelHostV1 | undefined) => panel?.ports?.forward;
    expectTypeOf(forwarder).returns.toEqualTypeOf<Ports['forward'] | undefined>();
    expect(forwarder(undefined)).toBeUndefined();
    expect(forwarder({ logs: { open: () => undefined } })).toBeUndefined();
  });

  it('has `forward` and nothing else: no list of the host\'s forwards, and no stop by an id the plugin did not start', () => {
    expectTypeOf<keyof Ports>().toEqualTypeOf<'forward'>();
  });
});

describe('forward', () => {
  it('takes a request and answers the forward the host started: its id, the port it listens on, a way to stop it, and the address when the producer states one', () => {
    expectTypeOf<Ports['forward']>().toEqualTypeOf<(request: PortForwardRequestV1) => Promise<PortForwardSessionV1>>();
    expectTypeOf<PortForwardSessionV1>().toEqualTypeOf<{
      readonly sessionId: string;
      readonly localPort: number;
      readonly localHost?: string | undefined;
      readonly stop: () => Promise<void>;
    }>();
  });

  it('answers a `stop` that takes nothing and says nothing but whether it worked: it is this forward\'s own, as the `close` of a Logs session is that session\'s', () => {
    expectTypeOf<PortForwardSessionV1['stop']>().toEqualTypeOf<() => Promise<void>>();
    expectTypeOf<Parameters<PortForwardSessionV1['stop']>['length']>().toEqualTypeOf<0>();
    expectTypeOf<PortForwardSessionV1['stop']>().returns.toEqualTypeOf<Promise<void>>();
  });

  it('answers the port as a number, and the address as text that may be absent: it is there only when the producer states where the forward listens', () => {
    expectTypeOf<PortForwardSessionV1['localPort']>().toEqualTypeOf<number>();
    expectTypeOf<PortForwardSessionV1['localHost']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RequiredKeys<PortForwardSessionV1>>().toEqualTypeOf<'sessionId' | 'localPort' | 'stop'>();
    const stated: PortForwardSessionV1 = { sessionId: 'a', localPort: 8080, localHost: '127.0.0.1', stop: async () => Promise.resolve() };
    const unstated: PortForwardSessionV1 = { sessionId: 'a', localPort: 8080, stop: async () => Promise.resolve() };
    expect([stated.localHost, unstated.localHost]).toEqual(['127.0.0.1', undefined]);
  });
});

describe('the request', () => {
  it('asks for a resource and a port and for nothing else: every other member is optional', () => {
    expectTypeOf<RequiredKeys<PortForwardRequestV1>>().toEqualTypeOf<'resourceId' | 'remotePort'>();
    expectTypeOf<{ readonly resourceId: string; readonly remotePort: number }>().toExtend<PortForwardRequestV1>();
  });

  it('has these members and no others: what a plugin may say is written down, so that a member added later is added on purpose', () => {
    expectTypeOf<keyof PortForwardRequestV1>().toEqualTypeOf<'resourceId' | 'resourceKey' | 'reference' | 'resourceData' | 'remotePort' | 'localPort' | 'protocol'>();
  });

  it('says its ports as whole numbers a person writes, and its protocol as TCP or UDP', () => {
    expectTypeOf<PortForwardRequestV1['remotePort']>().toEqualTypeOf<number>();
    expectTypeOf<PortForwardRequestV1['localPort']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<PortForwardRequestV1['protocol']>().toEqualTypeOf<'TCP' | 'UDP' | undefined>();
    expectTypeOf<PortForwardRequestV1['resourceId']>().toEqualTypeOf<string>();
    expectTypeOf<PortForwardRequestV1['resourceKey']>().toEqualTypeOf<string | undefined>();
  });

  it('is the runtime\'s typed start less the routing the host fills in: the same reference, body and protocols', () => {
    expectTypeOf<PortForwardRequestV1['reference']>().toEqualTypeOf<Target['reference']>();
    expectTypeOf<PortForwardRequestV1['reference']>().toEqualTypeOf<ResourceReference | undefined>();
    expectTypeOf<PortForwardRequestV1['resourceData']>().toEqualTypeOf<Target['resource_data']>();
    expectTypeOf<PortForwardRequestV1['resourceData']>().toEqualTypeOf<Value | undefined>();
    expectTypeOf<NonNullable<PortForwardRequestV1['protocol']>>().toEqualTypeOf<Exclude<NetworkerClient.PortForwardSessionRequest['protocol'], ''>>();
  });

  it('names no plugin, no connection and no route: the host fills in the first two from the page\'s own scope, and writes the third from the second, so the request has no member for any', () => {
    expectTypeOf<keyof PortForwardRequestV1 & ('pluginId' | 'plugin_id' | 'connectionId' | 'connection_id' | 'connection' | 'route')>().toEqualTypeOf<never>();
  });
});

describe('a refusal', () => {
  it('is an `Error` that says what it is by its name, how the host classes it by its code, why in plain words by its message, and what the host gave by its cause', () => {
    expectTypeOf<PortForwardErrorV1>().toExtend<Error>();
    expectTypeOf<PortForwardErrorV1['name']>().toEqualTypeOf<'PortForwardError'>();
    expectTypeOf<PortForwardErrorV1['code']>().toEqualTypeOf<PortForwardErrorCodeV1>();
    expectTypeOf<PortForwardErrorV1['message']>().toEqualTypeOf<string>();
    expectTypeOf<PortForwardErrorV1['cause']>().toEqualTypeOf<unknown>();
    const refusal = (error: PortForwardErrorV1): Error => error;
    expect(typeof refusal).toBe('function');
  });

  it('says the number it is about when the host\'s own count refused, and says nothing otherwise: `limit` is optional', () => {
    expectTypeOf<PortForwardErrorV1['limit']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<PortForwardErrorV1>().toExtend<{ readonly limit?: number | undefined }>();
    const full: PortForwardErrorV1 = Object.assign(new Error('This plugin already holds 64 forwards in this connection. Stop one first.'), { name: 'PortForwardError' as const, code: 'RESOURCE_LIMIT' as const, limit: 64 });
    const plain: PortForwardErrorV1 = Object.assign(new Error('The forward names no resource.'), { name: 'PortForwardError' as const, code: 'INVALID_REQUEST' as const });
    expect([full.limit, plain.limit]).toEqual([64, undefined]);
  });

  it('has the codes the contract lists and no others: the host\'s own classes that a forward can meet, and `UNKNOWN` for an answer that has none of them', () => {
    expectTypeOf<PortForwardErrorCodeV1>().toEqualTypeOf<
      | 'INVALID_REQUEST'
      | 'UNSUPPORTED'
      | 'FORBIDDEN'
      | 'UNAUTHORIZED'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'CANCELLED'
      | 'TIMEOUT'
      | 'UNAVAILABLE'
      | 'CONNECTION_ERROR'
      | 'RESOURCE_LIMIT'
      | 'PROVIDER_ERROR'
      | 'INTERNAL'
      | 'UNKNOWN'
    >();
  });

  it('is told apart by its code with a plain `switch`, which the compiler checks for every code the contract lists', () => {
    const advice = (code: PortForwardErrorCodeV1): string => {
      switch (code) {
        case 'INVALID_REQUEST':
          return 'fix the request';
        case 'PROVIDER_ERROR':
          return 'the plugin could not forward it';
        case 'CONNECTION_ERROR':
          return 'start the connection';
        case 'UNSUPPORTED':
        case 'FORBIDDEN':
        case 'UNAUTHORIZED':
        case 'NOT_FOUND':
        case 'CONFLICT':
        case 'CANCELLED':
        case 'TIMEOUT':
        case 'UNAVAILABLE':
        case 'RESOURCE_LIMIT':
        case 'INTERNAL':
        case 'UNKNOWN':
          return 'say the message';
      }
    };

    expect(advice('INVALID_REQUEST')).toBe('fix the request');
  });
});

describe('the checks above can fail', () => {
  it('a request names the resource and the port of it', () => {
    // @ts-expect-error a request names the port of the resource
    const noPort: PortForwardRequestV1 = { resourceId: 'a' };
    // @ts-expect-error a request names the resource
    const noResource: PortForwardRequestV1 = { remotePort: 80 };
    // @ts-expect-error a port is a number
    const textPort: PortForwardRequestV1 = { resourceId: 'a', remotePort: '80' };
    expect([noPort, noResource, textPort]).toHaveLength(3);
  });

  it('a page cannot name the plugin, the connection or the route to forward in: the host fills them in from the page\'s own scope', () => {
    // @ts-expect-error the plugin is the one that asks
    const plugin: PortForwardRequestV1 = { resourceId: 'a', remotePort: 80, pluginId: 'other' };
    // @ts-expect-error the connection is the one the page is read in
    const connection: PortForwardRequestV1 = { resourceId: 'a', remotePort: 80, connectionId: 'other' };
    // @ts-expect-error the route is the page's connection, which the host writes: a member that cannot carry anything is not one
    const route: PortForwardRequestV1 = { resourceId: 'a', remotePort: 80, route: { connection: 'north' } };
    expect([plugin, connection, route]).toHaveLength(3);
  });

  it('a protocol is TCP or UDP, as the host\'s forwarder takes it', () => {
    // @ts-expect-error `tcp` is not a protocol the host knows
    const lower: PortForwardRequestV1 = { resourceId: 'a', remotePort: 80, protocol: 'tcp' };
    // @ts-expect-error an empty protocol is the host's zero value, not a choice
    const empty: PortForwardRequestV1 = { resourceId: 'a', remotePort: 80, protocol: '' };
    expect([lower, empty]).toHaveLength(2);
  });

  it('a host\'s handle that answers a forward with only its id is not the contract\'s: the port and the way to stop it are owed', () => {
    // @ts-expect-error the id alone cannot say where the forward is, and cannot end it
    const idOnly = (ports: { readonly forward: () => Promise<{ readonly sessionId: string }> }): Ports => ports;
    // @ts-expect-error the port is owed
    const noPort = (ports: { readonly forward: () => Promise<Omit<PortForwardSessionV1, 'localPort'>> }): Ports => ports;
    // @ts-expect-error the way to stop it is owed
    const noStop = (ports: { readonly forward: () => Promise<Omit<PortForwardSessionV1, 'stop'>> }): Ports => ports;
    // @ts-expect-error the id is what the Ports tool knows the forward by
    const noId = (ports: { readonly forward: () => Promise<Omit<PortForwardSessionV1, 'sessionId'>> }): Ports => ports;
    expect([typeof idOnly, typeof noPort, typeof noStop, typeof noId]).toEqual(['function', 'function', 'function', 'function']);
  });

  it('a stop that takes an id is not the forward\'s own: it would stop any forward by its id', () => {
    // @ts-expect-error `stop` takes nothing: the forward it stops is the one it came with
    const byId = (session: Omit<PortForwardSessionV1, 'stop'> & { readonly stop: (sessionId: string) => Promise<void> }): PortForwardSessionV1 => session;
    expect(typeof byId).toBe('function');
  });

  it('a plain `Error` is not a refusal, and a code the contract does not list is not a code', () => {
    // @ts-expect-error an error with no code, and not named `PortForwardError`, is not the contract's
    const plain: PortForwardErrorV1 = new Error('no');
    // @ts-expect-error the codes are the host's classes, not a producer's own names
    const own: PortForwardErrorCodeV1 = 'PORT_UNAVAILABLE';
    // @ts-expect-error a code is written as the host writes it
    const lower: PortForwardErrorCodeV1 = 'provider_error';
    expect([plain, own, lower]).toHaveLength(3);
  });

  it('the refusal of another name is not the contract\'s', () => {
    // @ts-expect-error `name` says which error this is
    const named = (error: Omit<PortForwardErrorV1, 'name'> & { readonly name: 'Error' }): PortForwardErrorV1 => error;
    expect(typeof named).toBe('function');
  });

  it('an address is text and a limit is a number', () => {
    // @ts-expect-error an address is text, whatever the producer states
    const address: PortForwardSessionV1 = { sessionId: 'a', localPort: 8080, localHost: 7, stop: async () => Promise.resolve() };
    // @ts-expect-error a limit is the number the refusal is about
    const limit: PortForwardErrorV1 = Object.assign(new Error('no'), { name: 'PortForwardError' as const, code: 'RESOURCE_LIMIT' as const, limit: '64' });
    expect([address, limit]).toHaveLength(2);
  });
});
