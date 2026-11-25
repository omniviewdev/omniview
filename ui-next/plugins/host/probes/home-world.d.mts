// The types of home-world.mjs for the fixture (home-fixture.tsx imports the same connections the probe reasons about): the probes are plain ESM and carry no types of their own.

export type WorldState = 'connected' | 'connecting' | 'disconnected' | 'unauthorized' | 'forbidden' | 'unreachable' | 'failed';

export type WorldConnection = {
  readonly plugin: string;
  readonly key: string;
  readonly name: string;
  readonly detail: string | undefined;
  readonly state: WorldState;
  readonly reason: string | undefined;
};

export const PLUGIN: { readonly id: string; readonly name: string };
export const COUNT: number;
export const TARGET_INDEX: number;
export const SECOND_INDEX: number;
export const QUERY: string;
export function stateOf(index: number): { readonly state: WorldState; readonly reason: string | undefined };
export function connectionAt(index: number, options?: { readonly long?: boolean }): WorldConnection;
export function connectionsOf(count: number, options?: { readonly long?: boolean }): WorldConnection[];
export function keyOf(index: number): string;
