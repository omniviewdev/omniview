import type { WindowState } from '../../session';
import type { TerminalChannels } from './channel';
import type { TerminalShellAttempt } from './feed';

export const CAPABILITY_SLOT = 'terminal-capabilities';
export const CAPABILITY_DEADLINE_MS = 2_000;

export type ChannelSocket = {
  binaryType: 'arraybuffer' | 'blob';
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: Uint8Array): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: Event) => void): void;
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: Event) => void): void;
};

export type ChannelClient = {
  CreateTerminal(options: object, launch: object): PromiseLike<unknown>;
  CloseChannelTerminal(capability: string): PromiseLike<unknown>;
  DismissChannelTerminal(capability: string): PromiseLike<unknown>;
  ChannelTerminalBusy(capability: string): PromiseLike<unknown>;
  ListChannelTerminals(capabilities: string[]): PromiseLike<unknown>;
};

export type CapabilityStorage = {
  readonly read: () => Promise<string | undefined>;
  readonly write: (text: string) => Promise<void>;
};

export type ChannelDeps = {
  readonly client: ChannelClient;
  readonly openStream: (name: string) => ChannelSocket;
  readonly storage: CapabilityStorage;
  readonly warn?: ((message: string) => void) | undefined;
  readonly saved?: Readonly<Record<string, string>> | undefined;
};

export type { TerminalShellAttempt };

export function capabilityStorage(_options: { readonly client: WindowState; readonly name: () => Promise<string> }): CapabilityStorage {
  return { read: async () => Promise.resolve(undefined), write: async () => Promise.resolve() };
}

export function createTerminalChannels(_deps: ChannelDeps): TerminalChannels {
  const nothing = async (): Promise<undefined> => Promise.resolve(undefined);
  return {
    create: nothing,
    connect: () => ({ input: () => undefined, resize: () => undefined, ack: () => undefined, detach: () => undefined, close: () => undefined, pending: () => 0 }),
    close: nothing,
    dismiss: nothing,
    busy: nothing,
    list: async () => Promise.resolve([]),
    listed: async () => Promise.resolve(undefined),
    describe: () => '',
    isGone: () => false,
    codeOf: () => undefined,
    triedOf: () => undefined,
  };
}

export async function loadTerminalChannels(deps: ChannelDeps): Promise<TerminalChannels> {
  return Promise.resolve(createTerminalChannels(deps));
}

const inert = createTerminalChannels({ client: undefined as never, openStream: undefined as never, storage: { read: async () => Promise.resolve(undefined), write: async () => Promise.resolve() } });

export function appTerminalChannels(): TerminalChannels {
  return inert;
}

export async function loadAppTerminalChannels(): Promise<TerminalChannels> {
  return Promise.resolve(inert);
}
