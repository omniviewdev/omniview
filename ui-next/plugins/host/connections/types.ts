import type { StatusRole } from '@omniviewdev/kit';

// What the window knows of the connections of its plugins (HM1). A plugin's connection is its own: the host reads what the SDK gives every plugin (a key, a name, a readiness) and nothing of what the connection is
// (a cluster, an account, a database). The KEY is the plugin's id for it, which routes carry and which is never drawn (`connectionName.ts`); the NAME is what a person reads.

/**
 * Where a connection stands, as the host says it: connected; being connected; not connected; or a start that failed, by the class of the failure. The class is what the person can do about it
 * (sign in, ask for access, wait for the server), and it is read from the host's own error (`words.ts`), never from the text a plugin wrote.
 */
export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'unauthorized' | 'forbidden' | 'unreachable' | 'failed';

/** One connection of one plugin. */
export type HostConnection = {
  readonly plugin: string;
  /** The plugin's id for it: what a route carries. Never drawn. */
  readonly key: string;
  /** The plugin's secondary text for it (the SDK connection's `description`: a region, a provider), one line as the host makes it: whitespace collapsed, at most `DETAIL_MAX` characters. Absent when the plugin gives none. */
  readonly detail?: string | undefined;
  /** What a person reads. Never empty and never the key. */
  readonly name: string;
  readonly state: ConnectionState;
  /** Why the last start failed, in one line the host made safe to show. Absent unless the state is a failure the host saw. */
  readonly reason: string | undefined;
};

/** How a start ended. */
export type ConnectOutcome =
  | { readonly status: 'connected' }
  | { readonly status: 'failed'; readonly state: Exclude<ConnectionState, 'connected' | 'connecting' | 'disconnected'>; readonly reason: string };

/** The word and the role a state is drawn with (`words.ts`). */
export type StateFace = { readonly role: StatusRole; readonly word: string };
