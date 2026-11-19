// What the log stream costs with no renderer: lines a second through the subscription, the price of one batch, and the memory it holds. Skipped unless
// asked for, because a time is not a test:
//
//   LOG_STREAM_MEASURE=1 NODE_OPTIONS=--expose-gc node ../../node_modules/vitest/vitest.mjs run --configLoader runner src/logStream.measure.test.ts
//
// A batch is what the host sends: 100 lines, one JSON string, each line carrying its own labels (four, as a Pod's source has them) and a timestamp with
// nanoseconds. The transport is the real runtime's event dispatch with the topics driven by hand, so the numbers are the decode, the mapping and the
// buffer, and nothing of Wails' own cost.
import { CancellablePromise } from '@wailsio/runtime/cancellable';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type * as WailsRuntime from '@wailsio/runtime';
import { openLogStream } from './ui/v1';
import type { LogStream } from './ui/v1';

type Listener = (event: { data: unknown }) => void;
const transport = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
  create: vi.fn<(method: string, plugin: string, connection: string, encodedRequest: string) => unknown>(),
}));
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof WailsRuntime>();
  return {
    ...actual,
    Call: { ...actual.Call, ByName: transport.create, ByID: () => Promise.resolve() },
    Events: {
      ...actual.Events,
      On(key: string, listener: Listener) {
        const listeners = transport.listeners.get(key) ?? new Set();
        listeners.add(listener);
        transport.listeners.set(key, listeners);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
});

const enabled = process.env.LOG_STREAM_MEASURE === '1';
const results: Record<string, number | string> = {};
// Present when node runs with --expose-gc.
const gc: (() => void) | undefined = Reflect.get(globalThis, 'gc');

const LABELS = { pod: 'checkout-7c9d8b5f6-x2x9k', container: 'app', namespace: 'production', node: 'ip-10-0-12-34.ec2.internal' };
const TEXTS = [
  '{"level":"info","ts":"2026-11-19T10:15:30.123Z","msg":"request completed","method":"GET","path":"/api/v1/cart","status":200,"duration_ms":12}',
  '2026-11-19T10:15:30.456Z INFO  [checkout] order 8f3a91 accepted for customer 55120 (3 items, total 124.90 EUR)',
  'E1119 10:15:30.789012       1 reflector.go:138] failed to watch *v1.Pod: the server could not find the requested resource',
  '\u001b[32mGET\u001b[0m /healthz 200 0.4ms',
];

function wireBatch(from: number, count: number, withLabels = true): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, index) => ({
      session_id: '0c8a3c1e-2b1d-4c53-9d3b-3c43f5e7a001',
      source_id: `${LABELS.pod}/${LABELS.container}`,
      labels: withLabels ? LABELS : {},
      timestamp: `2026-11-19T10:15:${String((from + index) % 60).padStart(2, '0')}.${String((from + index) % 1000000000).padStart(9, '0')}Z`,
      content: TEXTS[(from + index) % TEXTS.length],
      origin: 0,
      level: 0,
    })),
  );
}

function open(options?: { maxBufferedLines?: number }): LogStream {
  const creation = CancellablePromise.withResolvers<{ id: string; active_sources: [] }>();
  transport.create.mockReturnValue(creation.promise);
  const stream = openLogStream({ plugin: 'kubernetes', connection: 'c', resourceKey: 'k8s:/pods', resourceId: 'checkout' }, options);
  creation.resolve({ id: stream.id, active_sources: [] });
  return stream;
}
function emit(stream: LogStream, data: string): void {
  for (const listener of transport.listeners.get(`core/logs/lines/${stream.id}`) ?? []) {
    listener({ data });
  }
}
function time(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}
const heap = (): number => {
  gc?.();
  return process.memoryUsage().heapUsed;
};

describe.skipIf(!enabled)('the cost of the log stream, with no renderer', () => {
  // A pool of distinct batches, cycled: building a batch is not what is measured.
  const pool = Array.from({ length: 256 }, (_, index) => wireBatch(index * 100, 100));
  results['bytes per batch of 100 lines, with labels'] = pool[0]!.length;
  results['bytes per batch of 100 lines, without labels'] = wireBatch(0, 100, false).length;

  it('parses a batch, with and without the labels every line carries', () => {
    const light = Array.from({ length: 256 }, (_, index) => wireBatch(index * 100, 100, false));
    const rounds = 40;
    // Microseconds for one batch of a pool, over `rounds` passes of it.
    const parse = (batches: readonly string[]): number =>
      (time(() => {
        for (let round = 0; round < rounds; round++) {
          for (const batch of batches) {
            JSON.parse(batch);
          }
        }
      }) / (rounds * batches.length)) * 1000;
    // Both pools are warm before anything is timed, and each sample times the pair in the other order from the sample before it, so that neither workload is
    // always the one that meets a cold engine or follows the other's garbage.
    for (let round = 0; round < 3; round++) {
      parse(pool);
      parse(light);
    }
    const samples: Array<{ order: string; labelled: number; unlabelled: number }> = [];
    for (let sample = 0; sample < 10; sample++) {
      const labelledFirst = sample % 2 === 0;
      const first = parse(labelledFirst ? pool : light);
      const second = parse(labelledFirst ? light : pool);
      samples.push(labelledFirst ? { order: 'labelled first', labelled: first, unlabelled: second } : { order: 'unlabelled first', labelled: second, unlabelled: first });
    }
    const median = (values: readonly number[]): number => {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = sorted.length >> 1;
      return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
    };
    const labelled = median(samples.map((sample) => sample.labelled));
    const unlabelled = median(samples.map((sample) => sample.unlabelled));
    results['JSON.parse of one batch, with labels (us, median of 10)'] = Math.round(labelled);
    results['JSON.parse of one batch, without labels (us, median of 10)'] = Math.round(unlabelled);
    results['the labels\' share of the parse (%)'] = Math.round((1 - unlabelled / labelled) * 100);
    // The raw samples with the order each ran in, so that the comparison can be checked against the order effect it is meant to be free of.
    results['parse samples (order: labelled us, unlabelled us)'] = samples.map((sample) => `${sample.order}: ${sample.labelled.toFixed(1)}, ${sample.unlabelled.toFixed(1)}`).join(' | ');
    expect(samples).toHaveLength(10);
  });

  it('takes batches as fast as they come, reading a frame (five batches) at a time', () => {
    const stream = open();
    const warm = 2000;
    for (let index = 0; index < warm; index++) {
      emit(stream, pool[index % pool.length]!);
      if (index % 5 === 4) {
        stream.read(500);
      }
    }
    const batches = 20_000;
    const elapsed = time(() => {
      for (let index = 0; index < batches; index++) {
        emit(stream, pool[index % pool.length]!);
        if (index % 5 === 4) {
          stream.read(500);
        }
      }
    });
    results['batch with frame reads: lines/s'] = Math.round((batches * 100) / (elapsed / 1000));
    results['batch with frame reads: us per batch'] = Math.round((elapsed / batches) * 1000);
    expect(stream.stats().received).toBe((warm + batches) * 100);
    void stream.close();
  });

  it('takes batches that nobody reads, at the bound', () => {
    const stream = open();
    for (let index = 0; index < 2000; index++) {
      emit(stream, pool[index % pool.length]!);
    }
    const batches = 20_000;
    const elapsed = time(() => {
      for (let index = 0; index < batches; index++) {
        emit(stream, pool[index % pool.length]!);
      }
    });
    results['batch at the bound, never read: lines/s'] = Math.round((batches * 100) / (elapsed / 1000));
    results['batch at the bound, never read: us per batch'] = Math.round((elapsed / batches) * 1000);
    const stats = stream.stats();
    expect(stats.held).toBe(100_000);
    expect(stats.dropped).toBe(stats.received - 100_000);
    results['drain of a full buffer (ms)'] = Number(time(() => {
      stream.read(100_000);
    }).toFixed(2));
    void stream.close();
  });

  it('holds memory flat at the bound however many lines go by', () => {
    const base = heap();
    const stream = open();
    const sample = (label: string): void => {
      results[`heap after ${label} (MB over the start)`] = Number(((heap() - base) / (1024 * 1024)).toFixed(1));
    };
    let sent = 0;
    for (const target of [100_000, 1_000_000, 3_000_000]) {
      while (sent < target) {
        emit(stream, pool[(sent / 100) % pool.length]!);
        sent += 100;
      }
      sample(`${String(target)} lines, none read`);
    }
    expect(stream.stats().held).toBe(100_000);
    void stream.close();
    sample('close');
  });

  afterAll(() => {
    console.log(`LOG_STREAM_MEASURE ${JSON.stringify(results, null, 2)}`);
  });
});
