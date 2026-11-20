import type { LogFeed, LogFeedLine, LogFeedSnapshot, LogFeedSource } from '@omniviewdev/kit';
import type { LogLine, LogSourceInfo, LogStream, LogStreamSnapshot } from '@omniviewdev/runtime/ui/v1';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { LogFeedSnapshotV1, LogFeedV1 } from './v1';

// The two ends of the log path were written separately and "should match": the runtime's `openLogStream` (packages/omniviewdev-runtime, P1b-1) returns a `LogStream`, and the kit's `LogView` (P1b-2)
// reads a `LogFeed`. The host hands one to the other through the contract's `LogFeedV1`. What this file proves is TYPES, so the proof is the compiler's: `tsc -p tsconfig.test.json` (CI's typecheck)
// fails on any line below when the runtime's stream stops being a kit feed. Vitest does not typecheck, so the runtime half of each test only names what the compiler checked; the controls at the end
// show the check can fail (an unused `@ts-expect-error` is itself an error).

describe('the object `openLogStream` returns', () => {
  it('is a kit `LogFeed` as it is: no adapter between the runtime and the view', () => {
    expectTypeOf<LogStream>().toExtend<LogFeed>();
    const feed = (stream: LogStream): LogFeed => stream;
    expect(typeof feed).toBe('function');
  });

  it('is the contract\'s `LogFeedV1`, which the host closes when the session does', () => {
    expectTypeOf<LogStream>().toExtend<LogFeedV1>();
    expectTypeOf<LogFeedV1['close']>().returns.toExtend<Promise<void> | void>();
    const feed = (stream: LogStream): LogFeedV1 => stream;
    expect(typeof feed).toBe('function');
  });

  it('and `LogFeedV1` is a `LogFeed`, so the view reads what the plugin hands over', () => {
    expectTypeOf<LogFeedV1>().toExtend<LogFeed>();
    const feed = (given: LogFeedV1): LogFeed => given;
    expect(typeof feed).toBe('function');
  });

  it('keeps the sources the card names: the snapshot a stream gives lists them by id', () => {
    expectTypeOf<LogStreamSnapshot>().toExtend<LogFeedSnapshotV1>();
    expectTypeOf<LogFeedSnapshotV1['sources']>().toExtend<ReadonlyArray<{ readonly id: string }> | undefined>();
  });

  // L2: the kit's Source column is drawn from what the runtime gives, with no adapter. A line's `source` is the id string the runtime's line already has; the sources a stream lists (id, labels, state) satisfy the
  // kit's `LogFeedSource` (an id and an optional label) as they are: the runtime has no `label`, so a row says the id, and a plugin that wraps the snapshot may give one.
  it('draws its Source column from what the runtime gives: its line is a kit line and its listed source is a kit source, as they are', () => {
    expectTypeOf<LogLine>().toExtend<LogFeedLine>();
    expectTypeOf<LogLine['source']>().toEqualTypeOf<LogFeedLine['source']>();
    expectTypeOf<LogSourceInfo>().toExtend<LogFeedSource>();
    expectTypeOf<LogStreamSnapshot['sources']>().toExtend<LogFeedSnapshot['sources']>();
    const source = (info: LogSourceInfo): LogFeedSource => info;
    expect(typeof source).toBe('function');
    // A plugin that wraps the snapshot to give friendlier names adds a `label` to each listed source; the contract's snapshot admits it (the kit's `LogFeedSource` is part of it), though `LogFeedSourceV1` names `labels` only.
    expectTypeOf<LogStreamSnapshot & { readonly sources: ReadonlyArray<LogSourceInfo & { readonly label: string }> }>().toExtend<LogFeedSnapshotV1>();
  });
});

describe('the checks above can fail', () => {
  it('a stream that cannot be read is not a feed, and a feed that cannot be closed is not the contract\'s', () => {
    // @ts-expect-error `read` is the one way lines come out of a feed
    const noRead = (stream: Omit<LogStream, 'read'>): LogFeed => stream;
    // @ts-expect-error the host closes a session's feed when its tab closes: a feed with no `close` would leak its listeners
    const noClose = (stream: Omit<LogStream, 'close'>): LogFeedV1 => stream;
    expect([typeof noRead, typeof noClose]).toEqual(['function', 'function']);
  });

  it('a state the view does not know is not a feed\'s state', () => {
    type Odd = Omit<LogStream, 'getSnapshot'> & { readonly getSnapshot: () => { readonly state: 'idle'; readonly paused: boolean; readonly cause: undefined } };
    // @ts-expect-error `idle` is not one of `starting`, `streaming`, `paused`, `ended`, `failed`
    const odd = (stream: Odd): LogFeed => stream;
    expect(typeof odd).toBe('function');
  });

  it('a source with no id, or a label that is not text, is not a kit source', () => {
    // @ts-expect-error a source is named by its id: the lines say it, and the view tells sources apart by it
    const noId = (info: Omit<LogSourceInfo, 'id'>): LogFeedSource => info;
    // @ts-expect-error a label is the text a row says
    const oddLabel = (info: LogSourceInfo & { readonly label: number }): LogFeedSource => info;
    expect([typeof noId, typeof oddLabel]).toEqual(['function', 'function']);
  });
});
