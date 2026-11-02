import type { AppError, QueryLeaseEvent, ResultMetadata, ResultRow } from './query-lease';
import type { Value } from './domain';

export type ObserverSnapshot = Readonly<{ status: 'attaching' | 'pending' | 'ready' | 'recovering' | 'complete' | 'closed'; generation?: string; rows: readonly ResultRow[]; metadata?: ResultMetadata; stale: boolean; error?: AppError }>;
export type ObserverAction = { kind: 'none' } | { kind: 'recover'; generation: string } | { kind: 'reopen' };
const NONE: ObserverAction = { kind: 'none' };
const MAX_UINT64 = (1n << 64n) - 1n;
const decimal = (s: string): boolean => typeof s === 'string' && /^(0|[1-9][0-9]*)$/.test(s) && s.length <= 20 && BigInt(s) <= MAX_UINT64;
const validIndex = (n: number, max: number) => Number.isSafeInteger(n) && n >= 0 && n <= max;

type ObjectValue = Record<string, unknown>;
function object(value: unknown, required: string[], optional: string[] = []): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function text(value: unknown): value is string { return typeof value === 'string'; }
function token(value: unknown): value is string { return text(value) && value.length > 0; }
function coverage(value: unknown): boolean { return value === 'complete' || value === 'partial' || value === 'unknown'; }

function validError(value: unknown): boolean {
  if (!object(value, ['type', 'title', 'status', 'detail'], ['instance', 'suggestions', 'actions', 'code', 'requestId', 'recovery', 'location'])) return false;
  if (!text(value.type) || !text(value.title) || !Number.isSafeInteger(value.status) || !text(value.detail)) return false;
  if (['instance', 'code', 'requestId', 'recovery'].some(key => key in value && !text(value[key]))) return false;
  if ('suggestions' in value && (!Array.isArray(value.suggestions) || !value.suggestions.every(text))) return false;
  if ('actions' in value && (!Array.isArray(value.actions) || !value.actions.every(action => object(action, ['type', 'label'], ['target']) && text(action.type) && text(action.label) && (!('target' in action) || text(action.target))))) return false;
  return !('location' in value) || (object(value.location, ['start', 'end', 'unit']) && Number.isSafeInteger(value.location.start) && Number.isSafeInteger(value.location.end) && text(value.location.unit));
}

function validMetadata(value: unknown): boolean {
  if (!object(value, ['coverage', 'limitations', 'freshness', 'count'], ['continuation']) ||
      !coverage(value.coverage) || !Array.isArray(value.limitations) || !value.limitations.every(text) ||
      !['current', 'snapshot', 'stale'].includes(value.freshness as string) ||
      ('continuation' in value && !token(value.continuation))) return false;
  const count = value.count;
  return (object(count, ['kind']) && count.kind === 'unknown') ||
    (object(count, ['kind', 'value']) && (count.kind === 'exact' || count.kind === 'estimate') && decimal(count.value as string));
}

function validEvent(value: unknown): value is QueryLeaseEvent {
  if (!object(value, ['lane', 'leaseId', 'payload'], ['generation', 'sequence']) || !token(value.leaseId)) return false;
  const payload = value.payload;
  if (value.lane === 'control') {
    if (!object(value, ['lane', 'leaseId', 'payload']) || !object(payload, ['kind'], ['reason', 'generation', 'nextGeneration', 'state', 'error'])) return false;
    if (payload.kind === 'reset') return object(payload, ['kind', 'generation', 'nextGeneration', 'reason']) && token(payload.generation) && token(payload.nextGeneration) && ['gap', 'overflow', 'sourceInvalidated', 'bindingChanged'].includes(payload.reason as string);
    if (payload.kind === 'control') return object(payload, ['kind', 'state', 'generation']) && payload.state === 'complete' && token(payload.generation);
    if (payload.kind === 'close') return object(payload, ['kind', 'reason'], ['error']) && ['closed', 'cancelled', 'failed', 'accessInvalidated'].includes(payload.reason as string) && (!('error' in payload) || validError(payload.error));
    return false;
  }
  if (value.lane !== 'data' || !object(value, ['lane', 'leaseId', 'generation', 'sequence', 'payload']) || !token(value.generation) || !decimal(value.sequence as string) || !object(payload, ['kind', 'metadata'], ['rows', 'changes']) || !validMetadata(payload.metadata)) return false;
  if (payload.kind === 'open') return object(payload, ['kind', 'rows', 'metadata']) && Array.isArray(payload.rows) && payload.rows.every(validRow);
  if (payload.kind !== 'changes' || !object(payload, ['kind', 'changes', 'metadata']) || !Array.isArray(payload.changes)) return false;
  return payload.changes.every(change => {
    if (!object(change, ['kind'], ['index', 'key', 'row'])) return false;
    if (change.kind === 'enter') return object(change, ['kind', 'index', 'row']) && Number.isSafeInteger(change.index) && validRow(change.row);
    if (change.kind === 'update') return object(change, ['kind', 'key', 'row']) && token(change.key) && validRow(change.row);
    if (change.kind === 'move') return object(change, ['kind', 'key', 'index']) && token(change.key) && Number.isSafeInteger(change.index);
    return (change.kind === 'leave' || change.kind === 'delete') && object(change, ['kind', 'key']) && token(change.key);
  });
}

function validValue(value: Value, depth = 0): boolean {
  if (!value || depth > 64 || !object(value, value.kind === 'null' ? ['kind'] : ['kind', 'value'])) return false;
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

function validRow(row: unknown): row is ResultRow {
  if (!object(row, ['key', 'targetId', 'resource', 'representation', 'provenance', 'values']) ||
      !token(row.key) || !token(row.targetId) || !object(row.resource, ['address'], ['incarnation']) ||
      ('incarnation' in row.resource && !token(row.resource.incarnation)) ||
      !object(row.resource.address, ['provider', 'authority', 'type', 'scope', 'id']) ||
      !token(row.resource.address.provider) || !token(row.resource.address.authority) ||
      !token(row.resource.address.type) || !token(row.resource.address.id) ||
      !Array.isArray(row.resource.address.scope) ||
      !row.resource.address.scope.every(entry => object(entry, ['dimension', 'value']) && token(entry.dimension) && text(entry.value)) ||
      !object(row.representation, ['id', 'revision']) || !token(row.representation.id) || !token(row.representation.revision) ||
      !object(row.provenance, ['source', 'coverage', 'stale']) || !token(row.provenance.source) ||
      !coverage(row.provenance.coverage) || typeof row.provenance.stale !== 'boolean' ||
      !row.values || typeof row.values !== 'object' || Array.isArray(row.values)) return false;
  return Object.values(row.values).every(value =>
    (object(value, ['state']) && (value.state === 'absent' || value.state === 'null')) ||
    (object(value, ['state', 'value']) && value.state === 'value' && validValue(value.value as Value)));
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
    if (this.snapshot.status === 'closed') return NONE;
    if (event && typeof event === 'object' && typeof event.leaseId === 'string' && event.leaseId !== this.leaseId) return NONE;
    if (this.snapshot.status === 'attaching') return this.fail();
    try {
      if (!validEvent(event) || new TextEncoder().encode(JSON.stringify(event)).length > 256 * 1024) {
        this.publish({ ...this.snapshot, rows: [], metadata: undefined, stale: false });
        return this.snapshot.status === 'complete' ? this.disconnected() : this.fail();
      }
    } catch {
      this.publish({ ...this.snapshot, rows: [], metadata: undefined, stale: false });
      return this.snapshot.status === 'complete' ? this.disconnected() : this.fail();
    }
    if (this.snapshot.status === 'complete' &&
        (event.lane === 'data' || (event.lane === 'control' && event.payload.kind === 'reset'))) return this.disconnected();
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
      if (!p.nextGeneration || p.nextGeneration === p.generation || p.nextGeneration === this.previousReset?.generation) {
        this.publish({ ...this.snapshot, rows: [], metadata: undefined, stale: false });
        return this.fail();
      }
      this.previousReset = { generation: p.generation, nextGeneration: p.nextGeneration };
      this.generation = p.nextGeneration; this.sequence = 0n; this.opened = false; this.recovering = false;
      const erase = p.reason === 'bindingChanged' || p.reason === 'sourceInvalidated';
      this.publish({ status: 'pending', generation: this.generation, rows: erase ? [] : this.snapshot.rows, metadata: erase ? undefined : this.snapshot.metadata, stale: !erase && this.snapshot.rows.length > 0 });
      return NONE;
    }
    if (event.generation !== this.generation || this.recovering) return NONE;
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
