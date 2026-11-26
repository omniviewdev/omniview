import { act, cleanup, render, screen as page } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GutterEvent } from './commandGutter';
import { useCommandGutter, type CommandGutterScreen } from './useCommandGutter';

// THE HOVER OF A MARK AND WHAT THE GUTTER SAYS (issue #694 step 5). The tooltip is in the document only while the pointer is on a mark, says what the producer said of the command (its line when the shell proved it, the status and the
// duration, the directory), can be put away with Escape without moving the pointer (WCAG 1.4.13), and what an action did is said to the body's live region, once. The screen is a fake with the one member the hook uses.

afterEach(() => {
  cleanup();
});

const COMMAND = { id: 'c1', state: 'failure', exit: 2, durationMs: 3_000, command: 'make test', cwd: '/home/u/src', line: 4 } as const;

function mount() {
  const listeners = new Set<(event: GutterEvent) => void>();
  const say = vi.fn<(words: string) => void>();
  const screen: CommandGutterScreen = {
    commands: {
      onEvent: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
  function Body(): ReactElement {
    const { element } = useCommandGutter({ screen, say });
    return <div data-testid="body">{element}</div>;
  }

  const view = render(<Body />);
  return {
    say,
    listeners: () => listeners.size,
    tell: (event: GutterEvent) => {
      act(() => {
        for (const listener of [...listeners]) {
          listener(event);
        }
      });
    },
    unmount: () => {
      view.unmount();
    },
  };
}

describe('the tooltip of a mark', () => {
  it('is not in the document until the pointer is on a mark', () => {
    mount();
    expect(page.queryByRole('tooltip')).toBeNull();
  });

  it('says the command, how it ended and for how long, and where, each on a line, and is gone when the pointer leaves', () => {
    const { tell } = mount();
    tell({ kind: 'hover', command: COMMAND, x: 40, y: 120 });
    const tip = page.getByRole('tooltip');
    expect([...tip.querySelectorAll('div')].map((line) => line.textContent)).toEqual(['make test', 'Failed, exit 2, took 3.0 s', '/home/u/src']);
    tell({ kind: 'hover', command: undefined, x: 0, y: 0 });
    expect(page.queryByRole('tooltip')).toBeNull();
  });

  it('shows no command line for a command the shell did not prove, and no directory it did not say: the lines are the facts it has', () => {
    const { tell } = mount();
    tell({ kind: 'hover', command: { id: 'c2', state: 'success', exit: 0, durationMs: 40, line: 1 }, x: 0, y: 0 });
    expect([...page.getByRole('tooltip').querySelectorAll('div')].map((line) => line.textContent)).toEqual(['Succeeded, took 40 ms']);
  });

  it('is drawn at the mark: its place is the mark\'s own, in the pixels of the window', () => {
    const { tell } = mount();
    tell({ kind: 'hover', command: COMMAND, x: 40, y: 120 });
    const tip = page.getByRole('tooltip');
    expect(tip.style.getPropertyValue('--_x')).toBe('40px');
    expect(tip.style.getPropertyValue('--_y')).toBe('120px');
  });

  it('is put away by Escape without moving the pointer, and the key is neither stopped nor cancelled; it comes back for the next mark', () => {
    const { tell } = mount();
    tell({ kind: 'hover', command: COMMAND, x: 40, y: 120 });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stop = vi.spyOn(event, 'stopPropagation');
    act(() => {
      window.dispatchEvent(event);
    });
    expect(page.queryByRole('tooltip')).toBeNull();
    expect(event.defaultPrevented).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    tell({ kind: 'hover', command: { ...COMMAND, id: 'c3' }, x: 40, y: 150 });
    expect(page.queryByRole('tooltip')).not.toBeNull();
  });

  it('stays away for the mark Escape put away while the pointer stays on it, and is not put away by another key', () => {
    const { tell } = mount();
    tell({ kind: 'hover', command: COMMAND, x: 40, y: 120 });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(page.queryByRole('tooltip')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    tell({ kind: 'hover', command: COMMAND, x: 40, y: 120 });
    expect(page.queryByRole('tooltip'), 'the same mark: it stays away').toBeNull();
  });
});

describe('what the gutter says', () => {
  it('gives the words of an action to the body to say, once each', () => {
    const { tell, say } = mount();
    tell({ kind: 'said', words: 'Command 1 of 3, Succeeded, took 1.5 s: ls' });
    tell({ kind: 'said', words: 'No previous command' });
    tell({ kind: 'said', words: 'No previous command' });
    expect(say.mock.calls.map(([words]) => words)).toEqual(['Command 1 of 3, Succeeded, took 1.5 s: ls', 'No previous command', 'No previous command']);
  });

  it('says nothing for a hover', () => {
    const { tell, say } = mount();
    tell({ kind: 'hover', command: COMMAND, x: 0, y: 0 });
    expect(say).not.toHaveBeenCalled();
  });

  it('listens while it lives and lets go when the body goes: no event is heard after', () => {
    const { listeners, unmount, tell, say } = mount();
    expect(listeners()).toBe(1);
    unmount();
    expect(listeners()).toBe(0);
    tell({ kind: 'said', words: 'late' });
    expect(say).not.toHaveBeenCalled();
  });
});
