import { afterEach, describe, expect, it } from 'vitest';
import { rootWrites } from './rootWrites.ts';

// The guard of the parts' "writes nothing to the document root" tests, tested on its own: it has to see a write for the tests that use it to mean anything.

const root = document.documentElement;

afterEach(() => {
  root.removeAttribute('data-probe');
  root.removeAttribute('style');
});

describe('rootWrites', () => {
  it('is empty for a run that writes nothing to the root, whatever else it writes', () => {
    const writes = rootWrites(() => {
      document.body.setAttribute('data-probe', '1');
      document.body.style.setProperty('--probe', '1');
      document.body.removeAttribute('data-probe');
    });

    expect(writes).toEqual([]);
    document.body.removeAttribute('style');
  });

  it('names an attribute written on the root by code that ran synchronously (the negative control: a run that did write is not empty)', () => {
    const writes = rootWrites(() => {
      root.setAttribute('data-probe', '1');
    });

    expect(writes).toEqual(['data-probe']);
  });

  it('counts a write that puts the value back: it was a write', () => {
    root.setAttribute('data-probe', 'a');
    const writes = rootWrites(() => {
      root.setAttribute('data-probe', 'b');
      root.setAttribute('data-probe', 'a');
      root.removeAttribute('data-probe');
    });

    expect(writes).toEqual(['data-probe', 'data-probe', 'data-probe']);
  });

  it('counts a custom property set on the root and removed again, as a write of the style attribute', () => {
    const writes = rootWrites(() => {
      root.style.setProperty('--probe', '1');
      root.style.removeProperty('--probe');
    });

    expect(writes).toEqual(['style', 'style']);
  });

  it('still hands back what a run wrote when the run throws, and disconnects', () => {
    let writes: string[] = [];
    expect(() => {
      writes = rootWrites(() => {
        root.setAttribute('data-probe', '1');
        throw new Error('the run failed');
      });
    }).toThrow('the run failed');
    // The observer is gone: a write after the run is nobody's record.
    root.setAttribute('data-probe', '2');
    expect(writes).toEqual([]);
    expect(rootWrites(() => undefined)).toEqual([]);
  });

  it('is needed: an observer that only disconnects loses the records of a synchronous write (the platform\'s rule, the reason the guard takes them first)', () => {
    const lost: MutationRecord[] = [];
    const observer = new MutationObserver((list) => {
      lost.push(...list);
    });
    observer.observe(root, { attributes: true });
    root.setAttribute('data-probe', '1');
    observer.disconnect();

    expect(lost).toEqual([]);
  });
});
