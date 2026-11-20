import { describe, expect, it, vi } from 'vitest';
import { createAnnouncer } from './host';

// The live region's source: what the palette model tells `PaletteSeam.announce` (a refusal, the result sentence once it settled) and what the view reads. A sentence that is said twice in a row is
// said twice (a screen reader hears a node that is inserted, not a text that is equal), so every announcement is a new value, with its own serial.

describe('the announcer', () => {
  it('holds nothing until it is told something', () => {
    expect(createAnnouncer().getSnapshot()).toEqual({ text: '', serial: 0 });
  });

  it('holds the last text, and counts every announcement, the same text included', () => {
    const announcer = createAnnouncer();
    announcer.announce('3 results');
    const first = announcer.getSnapshot();
    expect(first).toEqual({ text: '3 results', serial: 1 });
    announcer.announce('3 results');
    expect(announcer.getSnapshot()).toEqual({ text: '3 results', serial: 2 });
    expect(announcer.getSnapshot()).not.toBe(first);
  });

  it('gives the same object until something is announced', () => {
    const announcer = createAnnouncer();
    announcer.announce('One result');
    expect(announcer.getSnapshot()).toBe(announcer.getSnapshot());
  });

  it('tells every listener once for each announcement, and stops telling one that left', () => {
    const announcer = createAnnouncer();
    const heard = vi.fn();
    const left = vi.fn();
    const stop = announcer.subscribe(heard);
    announcer.subscribe(left)();
    announcer.announce('No results');
    announcer.announce('No results');
    stop();
    announcer.announce('One result');
    expect(heard).toHaveBeenCalledTimes(2);
    expect(left).not.toHaveBeenCalled();
  });

  it('says nothing when it is told an empty text', () => {
    const announcer = createAnnouncer();
    const heard = vi.fn();
    announcer.subscribe(heard);
    announcer.announce('');
    expect(heard).not.toHaveBeenCalled();
    expect(announcer.getSnapshot().serial).toBe(0);
  });
});
