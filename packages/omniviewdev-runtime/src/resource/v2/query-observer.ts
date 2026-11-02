import type { AppError, QueryLeaseEvent, ResultMetadata, ResultRow } from './query-lease';
import type { Value } from './domain';

export type ObserverSnapshot = Readonly<{ status: 'attaching' | 'pending' | 'ready' | 'recovering' | 'complete' | 'closed'; generation?: string; rows: readonly ResultRow[]; metadata?: ResultMetadata; stale: boolean; error?: AppError }>;
export type ObserverAction = { kind: 'none' } | { kind: 'recover'; generation: string } | { kind: 'reopen' };
const NONE: ObserverAction = { kind: 'none' };
const MAX_UINT64 = (1n << 64n) - 1n;
const decimal = (s: string): boolean => typeof s === 'string' && /^(0|[1-9][0-9]*)$/.test(s) && s.length <= 20 && BigInt(s) <= MAX_UINT64;
const validIndex = (n: number, max: number) => Number.isSafeInteger(n) && n >= 0 && n <= max;

function validValue(value: Value, depth = 0): boolean {
  if (!value || depth > 64) return false;
  switch (value.kind) {
    case 'null': return true;
    case 'bool': return typeof value.value === 'boolean';
    case 'string': case 'timestamp': return typeof value.value === 'string';
    case 'double': return typeof value.value === 'number' && Number.isFinite(value.value);
    case 'uint64': return decimal(value.value);
    case 'int64':
      return typeof value.value === 'string' && /^(-[1-9][0-9]*|0|[1-9][0-9]*)$/.test(value.value) && value.value.length <= 20 && BigInt(value.value) >= -(1n << 63n) && BigInt(value.value) < (1n << 63n);
    case 'list': return Array.isArray(value.value) && value.value.every(item => validValue(item, depth + 1));
    case 'map': return !!value.value && typeof value.value === 'object' && !Array.isArray(value.value) && Object.values(value.value).every(item => validValue(item, depth + 1));
    default: return false;
  }
}

function validRow(row: ResultRow): boolean {
  return !!row && typeof row.key === 'string' && !!row.key && !!row.values && typeof row.values === 'object' &&
    Object.values(row.values).every(value => value && (value.state === 'absent' || value.state === 'null' || (value.state === 'value' && validValue(value.value))));
}

// Published snapshots own their objects and cannot be changed by either caller or transport.
function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (v: unknown): void => {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
  };
  freeze(copy);
  return copy;
}

/** One instance per lease. Register the doorbell before calling attach(). */
export class QueryLeaseObserver {
  private snapshot: ObserverSnapshot = Object.freeze({ status: 'attaching', rows: Object.freeze([]), stale: false });
  private generation?: string;
  private sequence = 0n;
  private opened = false;
  private recovering = false;
  private previousReset?: { generation: string; nextGeneration: string };
  constructor(readonly leaseId: string, readonly maxRows: number) {
    if (!leaseId || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 512) throw new RangeError('Invalid lease or window bound');
  }
  getSnapshot(): ObserverSnapshot { return this.snapshot; }
  attach(generation: string): void {
    if (!generation || this.snapshot.status !== 'attaching') throw new Error('Invalid attachment');
    this.generation = generation;
    this.publish({ status: 'pending', generation, rows: [], stale: false });
  }
  /** A lost drain response cannot be retried: discard the lease and reopen. */
  disconnected(): ObserverAction { this.close(); return { kind: 'reopen' }; }
  close(): void {
    this.generation = undefined; this.previousReset = undefined; this.opened = false; this.recovering = false;
    this.publish({ status: 'closed', rows: [], stale: false });
  }
  apply(event: QueryLeaseEvent): ObserverAction {
    if (this.snapshot.status === 'closed' || event.leaseId !== this.leaseId) return NONE;
    if (this.snapshot.status === 'attaching') return this.fail();
    if (event.lane === 'control') {
      const p = event.payload;
      if (p.kind === 'close') {
        this.close();
        if (p.error) this.publish({ status: 'closed', rows: [], stale: false, error: p.error });
        return NONE;
      }
      if (p.kind === 'control') {
        if (p.generation === this.generation && this.opened && !this.recovering) this.publish({ ...this.snapshot, status: 'complete' });
        return NONE;
      }
      if (p.generation !== this.generation) return NONE;
      if (!p.nextGeneration || p.nextGeneration === p.generation || p.nextGeneration === this.previousReset?.generation) return this.fail();
      this.previousReset = { generation: p.generation, nextGeneration: p.nextGeneration };
      this.generation = p.nextGeneration; this.sequence = 0n; this.opened = false; this.recovering = false;
      const erase = p.reason === 'bindingChanged' || p.reason === 'sourceInvalidated';
      this.publish({ status: 'pending', generation: this.generation, rows: erase ? [] : this.snapshot.rows, metadata: erase ? undefined : this.snapshot.metadata, stale: !erase && this.snapshot.rows.length > 0 });
      return NONE;
    }
    if (event.generation !== this.generation || this.recovering) return NONE;
    if (this.snapshot.status === 'complete') return this.fail();
    try {
      if (new TextEncoder().encode(JSON.stringify(event)).length > 256 * 1024) return this.fail();
      if (!decimal(event.sequence) || BigInt(event.sequence) !== this.sequence + 1n) return this.fail();
      const payload = event.payload;
      if (payload.metadata.count.kind !== 'unknown' && !decimal(payload.metadata.count.value)) return this.fail();
      let rows: ResultRow[];
      if (payload.kind === 'open') {
        if (this.opened || payload.rows.length > this.maxRows) return this.fail();
        rows = payload.rows.slice();
        if (rows.some(row => !validRow(row)) || new Set(rows.map(row => row.key)).size !== rows.length) return this.fail();
      } else {
        if (!this.opened || payload.changes.length > 128) return this.fail();
        rows = this.snapshot.rows.slice();
        for (const change of payload.changes) {
          if (change.kind === 'enter') {
            if (!validRow(change.row) || rows.some(row => row.key === change.row.key) || !validIndex(change.index, rows.length) || rows.length >= this.maxRows) return this.fail();
            rows.splice(change.index, 0, change.row);
          } else {
            const index = rows.findIndex(row => row.key === change.key);
            if (index < 0) return this.fail();
            if (change.kind === 'update') {
              if (!validRow(change.row) || change.row.key !== change.key) return this.fail();
              rows[index] = change.row;
            } else if (change.kind === 'move') {
              const [row] = rows.splice(index, 1);
              if (!validIndex(change.index, rows.length)) return this.fail();
              rows.splice(change.index, 0, row);
            } else if (change.kind === 'leave' || change.kind === 'delete') rows.splice(index, 1);
            else return this.fail();
          }
        }
      }
      this.sequence = BigInt(event.sequence); this.opened = true;
      this.publish({ status: 'ready', generation: this.generation, rows, metadata: payload.metadata, stale: false });
      return NONE;
    } catch { return this.fail(); }
  }
  private fail(): ObserverAction {
    if (!this.generation) { this.close(); return { kind: 'reopen' }; }
    if (this.recovering) return NONE;
    this.recovering = true;
    this.publish({ ...this.snapshot, status: 'recovering', stale: this.snapshot.rows.length > 0 });
    return { kind: 'recover', generation: this.generation };
  }
  private publish(snapshot: ObserverSnapshot): void { this.snapshot = immutable(snapshot); }
}
