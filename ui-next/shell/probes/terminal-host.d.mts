// The types of terminal-host.mjs, which is plain JavaScript that runs in Node (the probe's own host) and in the fixture page (the page's own): the fixture is TypeScript, and `tsc` reads this.
export const LIMITS: Readonly<Record<string, number>>;
export const READ_MAX: number;
export const CHUNK: number;
export const KEPT_ENDS: number;
/** What the shell's `known` and `urls` commands print, a line each (the probe reads them from the fixture's `window.__known` and `window.__urls`). */
export const KNOWN: readonly string[];
export const URLS: readonly string[];
export const FRAME: Readonly<{ attach: 1; input: 2; resize: 3; ack: 4; detach: 5; close: 6; ready: 0x81; output: 0x82; gap: 0x83; ended: 0x84; takenOver: 0x85; notFound: 0x86; applied: 0x87; released: 0x88; unsupported: 0x89; closeRefused: 0x8a; marks: 0x8b }>;
/** The one version of the stream the host speaks (`attach.v`). */
export const VERSION: number;
export const pageFrames: {
  attach(cap: string, fromOffset?: number, version?: number, writer?: unknown, marks?: number): Uint8Array;
  input(bytes: Uint8Array | string): Uint8Array;
  resize(cols: number, rows: number): Uint8Array;
  ack(n: number): Uint8Array;
  detach(): Uint8Array;
  close(): Uint8Array;
};
export type HostFrame =
  | { kind: 'ready'; ready: Record<string, any> }
  | { kind: 'output'; offset: number; bytes: Uint8Array }
  | { kind: 'gap'; from: number; to: number }
  | { kind: 'ended'; end: Record<string, any> }
  | { kind: 'taken-over' }
  | { kind: 'not-found' }
  | { kind: 'applied'; n: number }
  | { kind: 'released' }
  | { kind: 'close-refused' }
  | { kind: 'unsupported'; v: unknown }
  | { kind: 'marks'; frame: { v: number; marks: Array<Record<string, any>> } }
  | { kind: 'unknown'; type: number };
export function readFrame(frame: Uint8Array): HostFrame;
export function toBase64(bytes: Uint8Array): string;
export function fromBase64(text: string): Uint8Array;
export function firstNumbered(bytes: Uint8Array): number | null;
export class Scanner {
  modes: Record<string, any>;
  readonly boundary: boolean;
  clone(): Scanner;
  feed(bytes: Uint8Array): void;
}
export class Ring {
  constructor(cols: number, rows: number, limit?: number);
  chunks: Array<{ start: number; length: number }>;
  end: number;
  readonly start: number;
  readonly overwritten: number;
  record(bytes: Uint8Array): void;
  resize(cols: number, rows: number): void;
  sizeAt(offset: number): { cols: number; rows: number };
  read(from: number, to: number): Uint8Array;
  modesAt(offset: number): Record<string, any>;
  trim(from: number): number;
}
export type HostOptions = {
  leaseMs?: number;
  ringBytes?: number;
  shell?: string;
  /** The synthetic shell has the shell integration: it prints marks with a nonce (`nonceOf`), and the terminals carry the marks frame to a page that asks. */
  integration?: boolean;
  fail?: 'shell-unavailable' | 'start';
  busy?: 'unknown' | 'hang';
  defer?: (task: () => void) => void;
  faults?: Record<string, boolean>;
};
export type HostStream = { readonly id: number; send(frame: Uint8Array): void; close(): void };
export type Host = {
  LIMITS: Record<string, number>;
  log: any;
  faults: Record<string, boolean>;
  call(method: string, args: readonly unknown[]): Promise<any>;
  openStream(deliver: (frame: Uint8Array) => void, onClosed?: () => void): HostStream;
  streams(): Array<{ id: number; terminal: string | null; holder: boolean }>;
  holdReady(id: string): { held(): boolean; release(): void };
  slow(calls: number, ms: number): void;
  release(): void;
  append(id: string, text: string): void;
  flood(id: string, lines: number, width: number): void;
  burst(id: string, events: number): { delivered: number; paused: boolean; waiting: number };
  type(id: string, text: string): void;
  end(id: string, end?: Record<string, unknown>): void;
  setSize(id: string, rows: number, cols: number): void;
  drop(id: string): void;
  vanish(id: string): void;
  restart(): void;
  trimRing(id: string, from: number): number;
  plant(id: string, text: string): void;
  ids(): string[];
  capabilityOf(id: string): string;
  keptEnds(): Array<{ id: string; end: Record<string, any>; expires: number }>;
  state(id: string): Record<string, any> | undefined;
  /** The session's nonce of a terminal whose shell has the integration (a test seam for the canary): `undefined` for one with none. */
  nonceOf(id: string): string | undefined;
  bytes(id: string, from?: number): Uint8Array;
  waiting(): number;
  paused(): boolean;
  stop(): void;
};
export function createHost(options?: HostOptions): Host;
