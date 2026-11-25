import { describe, expect, it } from 'vitest';
import { createForwardLedger, type Place, type Taken } from './portLedger';
import { ledgerWorld } from './portTesting';

// The count a window keeps of the forwards it has started (PF2, `portLedger.ts`): a place is taken at the call, before the host answers, and kept until the forward ends. The limits are given, so that the counting is checked
// in a few steps with small numbers; `portForward.cap.test.ts` is the real caps, through the handle a page holds. The feeds the ledger listens to are fakes the test moves.

const LIMITS = { connection: 3, window: 5 } as const;

function ledgerOf() {
  const world = ledgerWorld();
  return { world, ledger: createForwardLedger(world.deps, LIMITS) };
}

/** The place a reservation gave, for a test that says there was room. */
function placeOf(taken: Taken): Place {
  if (taken.kind !== 'place') {
    throw new Error(`there was no place: the ${taken.scope} is full`);
  }

  return taken.place;
}

describe('a reservation', () => {
  it('gives a place until the plugin holds as many in a connection as it may, and then says the connection is full, with the number', () => {
    const { ledger } = ledgerOf();
    for (let one = 0; one < LIMITS.connection; one += 1) {
      placeOf(ledger.reserve('acme', 'north'));
    }

    expect(ledger.reserve('acme', 'north')).toEqual({ kind: 'full', scope: 'connection', limit: LIMITS.connection });
  });

  it('counts each plugin in each connection on its own: a full connection leaves the others', () => {
    const { ledger } = ledgerOf();
    for (let one = 0; one < LIMITS.connection; one += 1) {
      placeOf(ledger.reserve('acme', 'north'));
    }

    expect(ledger.reserve('acme', 'north').kind).toBe('full');
    expect(ledger.reserve('acme', 'south').kind).toBe('place');
    expect(ledger.reserve('beta', 'north').kind).toBe('place');
  });

  it('tells a plugin and a connection apart whatever their names: one whose names join to those of another is not the other', () => {
    const { ledger } = ledgerOf();
    for (let one = 0; one < LIMITS.connection; one += 1) {
      placeOf(ledger.reserve('a', 'b:c'));
    }

    expect(ledger.reserve('a', 'b:c').kind).toBe('full');
    expect(ledger.reserve('a:b', 'c').kind).toBe('place');
    expect(ledger.reserve('a\u0000b', 'c').kind).toBe('place');
  });

  it('gives a place until the window holds as many in all as it may, and then says the window is full, with the number', () => {
    const { ledger } = ledgerOf();
    placeOf(ledger.reserve('acme', 'north'));
    placeOf(ledger.reserve('acme', 'north'));
    placeOf(ledger.reserve('beta', 'south'));
    placeOf(ledger.reserve('beta', 'south'));
    placeOf(ledger.reserve('gamma', 'east'));
    expect(ledger.reserve('delta', 'west')).toEqual({ kind: 'full', scope: 'window', limit: LIMITS.window });
  });

  it('says the connection is full before it says the window is, when both are: it is the one a person can do something about', () => {
    const { ledger } = ledgerOf();
    for (let one = 0; one < LIMITS.connection; one += 1) {
      placeOf(ledger.reserve('acme', 'north'));
    }

    placeOf(ledger.reserve('beta', 'south'));
    placeOf(ledger.reserve('beta', 'south'));
    expect(ledger.reserve('acme', 'north')).toEqual({ kind: 'full', scope: 'connection', limit: LIMITS.connection });
  });

  it('takes nothing when it says a cap is full: the refusals are free, however many there are', () => {
    const { ledger, world } = ledgerOf();
    for (let one = 0; one < LIMITS.connection; one += 1) {
      placeOf(ledger.reserve('acme', 'north'));
    }

    for (let one = 0; one < 100; one += 1) {
      expect(ledger.reserve('acme', 'north').kind).toBe('full');
    }

    expect(world.subscribed()).toEqual({ closed: 1, plugins: 1 });
    placeOf(ledger.reserve('beta', 'north'));
    placeOf(ledger.reserve('beta', 'north'));
    expect(ledger.reserve('beta', 'north').kind).toBe('full');
  });
});

describe('a place', () => {
  it('is given back by `release`, and only once: a second release gives back nothing', () => {
    const { ledger } = ledgerOf();
    const places = Array.from({ length: LIMITS.connection }, () => placeOf(ledger.reserve('acme', 'north')));
    places[0]?.release();
    places[0]?.release();
    placeOf(ledger.reserve('acme', 'north'));
    expect(ledger.reserve('acme', 'north').kind).toBe('full');
  });

  it('is given back when the host says the forward it holds is closed, and not when it says another is', () => {
    const { ledger, world } = ledgerOf();
    const places = Array.from({ length: LIMITS.connection }, () => placeOf(ledger.reserve('acme', 'north')));
    places[0]?.hold('one');
    places[1]?.hold('two');
    world.closed('three');
    expect(ledger.reserve('acme', 'north').kind).toBe('full');
    world.closed('two');
    placeOf(ledger.reserve('acme', 'north'));
    expect(ledger.reserve('acme', 'north').kind).toBe('full');
  });

  it('is given back once for a forward that is released and then closed: the two are one end', () => {
    const { ledger, world } = ledgerOf();
    const places = Array.from({ length: LIMITS.connection }, () => placeOf(ledger.reserve('acme', 'north')));
    places[0]?.hold('one');
    places[0]?.release();
    world.closed('one');
    placeOf(ledger.reserve('acme', 'north'));
    expect(ledger.reserve('acme', 'north').kind).toBe('full');
  });

  it('is not held again by a forward that was released: the end of a call that came too late counts nothing', () => {
    const { ledger, world } = ledgerOf();
    const places = Array.from({ length: LIMITS.connection }, () => placeOf(ledger.reserve('acme', 'north')));
    places[0]?.release();
    places[0]?.hold('late');
    world.closed('late');
    placeOf(ledger.reserve('acme', 'north'));
    expect(ledger.reserve('acme', 'north').kind).toBe('full');
  });

  it('is given back at once for a forward that was closed before the place knew its id: the host\'s event can come before the answer to the start', () => {
    const { ledger, world } = ledgerOf();
    const place = placeOf(ledger.reserve('acme', 'north'));
    world.closed('early');
    place.hold('early');
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
  });

  it('forgets what was closed early once nothing waits for an id: a forward that is given that id later is held', () => {
    const { ledger, world } = ledgerOf();
    const first = placeOf(ledger.reserve('acme', 'north'));
    world.closed('early');
    first.hold('other');
    // Nothing waits for an id now, so the early close is forgotten, and the second forward is held with the first: two of the three places.
    const second = placeOf(ledger.reserve('acme', 'north'));
    second.hold('early');
    placeOf(ledger.reserve('acme', 'north'));
    expect(ledger.reserve('acme', 'north').kind).toBe('full');
  });

  it('is held by id for the later of two forwards that the host gave one id: the release of the earlier leaves the later where it is', () => {
    const { ledger, world } = ledgerOf();
    const earlier = placeOf(ledger.reserve('acme', 'north'));
    const later = placeOf(ledger.reserve('acme', 'north'));
    earlier.hold('same');
    later.hold('same');
    earlier.release();
    // The host says `same` is closed: the one that holds the id is given back.
    world.closed('same');
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
  });
});

describe('a plugin that stops', () => {
  it('gives back every place it holds, held or in flight, in every connection', () => {
    const { ledger, world } = ledgerOf();
    placeOf(ledger.reserve('acme', 'north')).hold('one');
    placeOf(ledger.reserve('acme', 'north'));
    placeOf(ledger.reserve('acme', 'south'));
    world.stopped('acme');
    // Had one of the three been kept, the window would be full before the fifth.
    for (let one = 0; one < LIMITS.connection; one += 1) {
      placeOf(ledger.reserve('acme', 'north'));
    }

    placeOf(ledger.reserve('acme', 'south'));
    placeOf(ledger.reserve('acme', 'south'));
    expect(ledger.reserve('acme', 'north').kind).toBe('full');
  });

  it('gives back no place of another plugin', () => {
    const { ledger, world } = ledgerOf();
    placeOf(ledger.reserve('acme', 'north'));
    placeOf(ledger.reserve('beta', 'north'));
    placeOf(ledger.reserve('beta', 'north'));
    world.stopped('acme');
    placeOf(ledger.reserve('beta', 'north'));
    expect(ledger.reserve('beta', 'north').kind).toBe('full');
  });

  it('is told of whenever the window\'s plugins change, and acts only on those that no longer run', () => {
    const { ledger, world } = ledgerOf();
    placeOf(ledger.reserve('acme', 'north'));
    placeOf(ledger.reserve('beta', 'north'));
    world.stopped('gamma');
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    world.stopped('acme');
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    world.stopped('beta');
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
  });
});

describe('what the ledger listens to', () => {
  it('is nothing until a place is taken', () => {
    const { world } = ledgerOf();
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
    expect(world.subscribed()).toEqual({ closed: 0, plugins: 0 });
  });

  it('is one listener on each feed from the first place, and the same two for every place after it', () => {
    const { ledger, world } = ledgerOf();
    placeOf(ledger.reserve('acme', 'north'));
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    placeOf(ledger.reserve('beta', 'south'));
    placeOf(ledger.reserve('acme', 'north'));
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    expect(world.subscribed()).toEqual({ closed: 1, plugins: 1 });
  });

  it('is nothing again when the last place is released, in whatever order the places go, and the same two again for the next place', () => {
    const { ledger, world } = ledgerOf();
    const places = [placeOf(ledger.reserve('acme', 'north')), placeOf(ledger.reserve('beta', 'south')), placeOf(ledger.reserve('acme', 'north'))];
    places[1]?.release();
    places[0]?.release();
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    places[2]?.release();
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
    placeOf(ledger.reserve('acme', 'north'));
    expect(world.listening()).toEqual({ closed: 1, plugins: 1 });
    expect(world.subscribed()).toEqual({ closed: 2, plugins: 2 });
  });

  it('takes nothing when the subscription itself fails: the counts are what they were, and the next place is given', () => {
    const world = ledgerWorld();
    let failing = true;
    const ledger = createForwardLedger(
      {
        onClosed: (listener) => {
          if (failing) {
            throw new Error('the events are not there');
          }

          return world.deps.onClosed(listener);
        },
        plugins: world.deps.plugins,
      },
      LIMITS,
    );
    expect(() => ledger.reserve('acme', 'north')).toThrow('the events are not there');
    failing = false;
    for (let one = 0; one < LIMITS.connection; one += 1) {
      placeOf(ledger.reserve('acme', 'north'));
    }

    expect(ledger.reserve('acme', 'north').kind).toBe('full');
  });

  it('leaves nothing listening when the second subscription fails: the first is given back, and the counts are what they were', () => {
    const world = ledgerWorld();
    const ledger = createForwardLedger(
      {
        onClosed: world.deps.onClosed,
        plugins: {
          running: world.deps.plugins.running,
          subscribe: () => {
            throw new Error('the plugins are not there');
          },
        },
      },
      LIMITS,
    );
    expect(() => ledger.reserve('acme', 'north')).toThrow('the plugins are not there');
    expect(world.listening()).toEqual({ closed: 0, plugins: 0 });
    expect(world.subscribed()).toEqual({ closed: 1, plugins: 0 });
  });
});
