import { describe, expect, it } from 'vitest';
import { createRunner, type Outcome } from './runner';
import { after, deferred, manualClock, type Deferred } from './testing';

// The runner is what makes an asynchronous check safe to type over: one request per key, debounced, aborted when the next one comes, its late answer never delivered, bounded in
// flight, and a time limit. The palette's runner (`../palette/runner.ts`) is its model; this one is for any asynchronous work, keyed.

function setup(inFlight?: number) {
  const clock = manualClock();
  const errors: unknown[] = [];
  const runner = createRunner({ scheduler: clock.scheduler, inFlight, onError: (error) => {
    errors.push(error); 
  } });
  const outcomes: Array<{ readonly key: string; readonly outcome: Outcome<unknown> }> = [];
  const deliver = (key: string) => (outcome: Outcome<unknown>): void => {
    outcomes.push({ key, outcome });
  };

  return { clock, runner, outcomes, deliver, errors };
}

describe('a request', () => {
  it('starts after its delay, and its answer is delivered once', async () => {
    const { clock, runner, outcomes, deliver } = setup();
    const started: string[] = [];
    runner.run('a', { delay: 150, timeout: 5000, started: () => {
      started.push('a'); 
    }, work: () => 'answer', done: deliver('a') });
    await clock.advance(149);
    expect(started).toEqual([]);
    await clock.advance(1);
    expect(started).toEqual(['a']);
    expect(outcomes).toEqual([{ key: 'a', outcome: { status: 'done', value: 'answer' } }]);
  });

  it('starts at once when it has no delay', () => {
    const { runner, deliver } = setup();
    const started: string[] = [];
    runner.run('a', { delay: 0, timeout: 5000, started: () => {
      started.push('a'); 
    }, work: () => 'x', done: deliver('a') });
    expect(started).toEqual(['a']);
  });

  it('is told how it went when it fails: a throw, a rejection', async () => {
    const { clock, runner, outcomes, deliver } = setup();
    const boom = new Error('boom');
    runner.run('sync', { delay: 0, timeout: 5000, work: () => {
      throw boom; 
    }, done: deliver('sync') });
    runner.run('async', { delay: 0, timeout: 5000, work: async () => {
      await Promise.resolve(); throw boom; 
    }, done: deliver('async') });
    await clock.flush();
    expect(outcomes.map((entry) => [entry.key, entry.outcome.status])).toEqual([['sync', 'failed'], ['async', 'failed']]);
    expect(outcomes.every((entry) => entry.outcome.status === 'failed' && entry.outcome.error === boom)).toBe(true);
  });

  it('has a time limit: it is aborted, "timeout" is delivered, and what it answers later is ignored', async () => {
    const { clock, runner, outcomes, deliver } = setup();
    let signal: AbortSignal | undefined;
    const late = deferred<string>();
    runner.run('a', { delay: 0, timeout: 1000, work: async (given) => {
      signal = given; return late.promise; 
    }, done: deliver('a') });
    await clock.advance(1000);
    expect(outcomes).toEqual([{ key: 'a', outcome: { status: 'timeout' } }]);
    expect(signal?.aborted).toBe(true);
    late.resolve('too late');
    await clock.flush();
    expect(outcomes).toHaveLength(1);
  });

  it('is not troubled by a listener that throws: the next request still runs', async () => {
    const { clock, runner, outcomes, deliver, errors } = setup();
    runner.run('a', { delay: 0, timeout: 1000, work: () => 1, done: () => {
      throw new Error('listener'); 
    } });
    runner.run('b', { delay: 0, timeout: 1000, work: () => 2, done: deliver('b') });
    await clock.flush();
    expect(outcomes).toEqual([{ key: 'b', outcome: { status: 'done', value: 2 } }]);
    expect(errors).toHaveLength(1);
  });
});

describe('a newer request for the same key', () => {
  it('replaces one that has not started: only the last runs (a debounce)', async () => {
    const { clock, runner, outcomes, deliver } = setup();
    const ran: number[] = [];
    for (const n of [1, 2, 3]) {
      runner.run('a', { delay: 400, timeout: 5000, work: () => {
        ran.push(n); return n; 
      }, done: deliver('a') });
      await clock.advance(100);
    }

    await clock.advance(400);
    expect(ran).toEqual([3]);
    expect(outcomes).toEqual([{ key: 'a', outcome: { status: 'done', value: 3 } }]);
  });

  it('aborts one that is running, and never delivers its answer, whether or not it honours the signal', async () => {
    const { clock, runner, outcomes, deliver } = setup();
    const signals: AbortSignal[] = [];
    const slow = deferred<string>();
    runner.run('a', { delay: 0, timeout: 5000, work: async (signal) => {
      signals.push(signal); return slow.promise; 
    }, done: deliver('a') });
    runner.run('a', { delay: 0, timeout: 5000, work: (signal) => {
      signals.push(signal); return 'new'; 
    }, done: deliver('a') });
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    slow.resolve('old');
    await clock.flush();
    expect(outcomes).toEqual([{ key: 'a', outcome: { status: 'done', value: 'new' } }]);
  });

  it('does not touch another key', async () => {
    const { clock, runner, outcomes, deliver } = setup();
    runner.run('a', { delay: 100, timeout: 5000, work: () => 'a', done: deliver('a') });
    runner.run('b', { delay: 100, timeout: 5000, work: () => 'b', done: deliver('b') });
    await clock.advance(100);
    expect(outcomes.map((entry) => entry.key).sort()).toEqual(['a', 'b']);
  });
});

describe('cancel', () => {
  it('stops a request that has not started, and aborts one that runs, and delivers nothing', async () => {
    const { clock, runner, outcomes, deliver } = setup();
    let signal: AbortSignal | undefined;
    runner.run('waiting', { delay: 100, timeout: 5000, work: () => 'x', done: deliver('waiting') });
    runner.run('running', { delay: 0, timeout: 5000, work: async (given) => {
      signal = given; return after(clock, 50, 'y', given); 
    }, done: deliver('running') });
    expect(runner.cancel('waiting')).toBe(true);
    expect(runner.cancel('running')).toBe(true);
    expect(runner.cancel('nothing')).toBe(false);
    expect(signal?.aborted).toBe(true);
    await clock.advance(1000);
    expect(outcomes).toEqual([]);
    expect(runner.active('waiting')).toBe(false);
    expect(runner.running()).toBe(0);
  });

  it('cancels everything with cancelAll', async () => {
    const { clock, runner, outcomes, deliver } = setup();
    for (const key of ['a', 'b', 'c']) {
      runner.run(key, { delay: 10, timeout: 5000, work: () => key, done: deliver(key) });
    }

    runner.cancelAll();
    await clock.advance(1000);
    expect(outcomes).toEqual([]);
    expect(clock.pending()).toBe(0);
  });
});

describe('the bound on what runs at once', () => {
  it('holds the rest back in the order they were asked, and starts each when a place frees up', async () => {
    const { clock, runner, outcomes, deliver } = setup(2);
    const gates = new Map<string, Deferred<string>>();
    const started: string[] = [];
    for (const key of ['a', 'b', 'c', 'd']) {
      const gate = deferred<string>();
      gates.set(key, gate);
      runner.run(key, { delay: 0, timeout: 60_000, started: () => {
        started.push(key); 
      }, work: async () => gate.promise, done: deliver(key) });
    }

    expect(started).toEqual(['a', 'b']);
    expect(runner.running()).toBe(2);
    gates.get('a')?.resolve('A');
    await clock.flush();
    expect(started).toEqual(['a', 'b', 'c']);
    gates.get('c')?.resolve('C');
    gates.get('b')?.resolve('B');
    await clock.flush();
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    gates.get('d')?.resolve('D');
    await clock.flush();
    expect(outcomes.map((entry) => entry.key)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('drops a request that was held back when it is replaced', async () => {
    const { clock, runner, deliver } = setup(1);
    const ran: string[] = [];
    const gate = deferred<string>();
    runner.run('a', { delay: 0, timeout: 60_000, work: async () => gate.promise, done: deliver('a') });
    runner.run('b', { delay: 0, timeout: 60_000, work: () => {
      ran.push('b1'); return 'x'; 
    }, done: deliver('b') });
    runner.run('b', { delay: 0, timeout: 60_000, work: () => {
      ran.push('b2'); return 'x'; 
    }, done: deliver('b') });
    gate.resolve('A');
    await clock.flush();
    expect(ran).toEqual(['b2']);
  });

  it('frees the place of a request that is replaced while it runs, so a check that ignores its signal cannot hold the others up', async () => {
    const { clock, runner, outcomes, deliver } = setup(1);
    const stuck = deferred<string>();
    runner.run('a', { delay: 0, timeout: 60_000, work: async () => stuck.promise, done: deliver('a') });
    runner.run('b', { delay: 0, timeout: 60_000, work: () => 'b', done: deliver('b') });
    expect(outcomes).toEqual([]);
    runner.cancel('a');
    await clock.flush();
    expect(outcomes).toEqual([{ key: 'b', outcome: { status: 'done', value: 'b' } }]);
  });
});
