import { describe, expect, it, vi } from 'vitest';
import { guardCommands, type CommandFailure } from './pageFailures';

// What the host does when a command of a page's header fails (ch16 S75, S85: a failed action of a page is a notice, a refused one is the page's own words): the plugin's `onSelect` is wrapped where the host draws
// the header, so a throw, or a promise that rejects (a plugin's handler is `async` and the contract types it as `() => void`), is reported with what failed and a way to ask again, and never reaches the window's
// error report. A command that works is called through untouched.

const error = new Error('boom');
const reporter = () => vi.fn<CommandFailure>();
const throws = (): void => {
  throw error;
};

describe('guardCommands', () => {
  it('leaves nothing alone that is nothing: a page with no commands has none', () => {
    expect(guardCommands(undefined, reporter())).toBeUndefined();
  });

  it('keeps everything a command says but the function that runs it: its words, its glyph, why it cannot run, that it is busy', () => {
    const onSelect = vi.fn();
    const guarded = guardCommands({ primary: { id: 'scale', label: 'Scale', icon: 'layers', onSelect, busy: true, disabledReason: 'Not now' } }, reporter());
    expect(guarded?.primary).toMatchObject({ id: 'scale', label: 'Scale', icon: 'layers', busy: true, disabledReason: 'Not now' });
    expect(guarded?.primary?.onSelect).not.toBe(onSelect);
  });

  it('guards every place a command is: the primary, the secondary ones, the danger one and the overflow menu, with the words of each', () => {
    const failed = reporter();
    const guarded = guardCommands(
      {
        primary: { id: 'a', label: 'A', onSelect: throws },
        secondary: [{ id: 'b', label: 'B', onSelect: throws }, { id: 'c', label: 'C', onSelect: throws }],
        danger: { id: 'd', label: 'D', onSelect: throws },
        menu: [{ id: 'e', label: 'E', onSelect: throws, destructive: true, separatorBefore: true }],
      },
      failed,
    );
    guarded?.primary?.onSelect();
    guarded?.secondary?.[0]?.onSelect();
    guarded?.secondary?.[1]?.onSelect();
    guarded?.danger?.onSelect();
    guarded?.menu?.[0]?.onSelect();
    expect(failed.mock.calls.map((call) => call[2])).toEqual([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'd', label: 'D' },
      { id: 'e', label: 'E' },
    ]);
    expect(guarded?.menu?.[0]).toMatchObject({ destructive: true, separatorBefore: true });
  });

  it('calls a command that works through, once, and reports nothing', () => {
    const onSelect = vi.fn();
    const failed = reporter();
    guardCommands({ primary: { id: 'a', label: 'A', onSelect } }, failed)?.primary?.onSelect();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('reports a command that throws, with the error, what failed and a way to ask again, and does not throw into the click', () => {
    const failed = reporter();
    const guarded = guardCommands({ primary: { id: 'a', label: 'Scale', onSelect: throws } }, failed);
    expect(() => {
      guarded?.primary?.onSelect();
    }).not.toThrow();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0]?.[0]).toBe(error);
    expect(typeof failed.mock.calls[0]?.[1]).toBe('function');
    expect(failed.mock.calls[0]?.[2]).toEqual({ id: 'a', label: 'Scale' });
  });

  it('reports a command whose promise rejects, once it has: the contract types a handler as returning nothing, and a plugin\'s is async', async () => {
    const failed = reporter();
    const later: () => void = async () => {
      await Promise.resolve();
      throw error;
    };

    guardCommands({ primary: { id: 'a', label: 'Scale', onSelect: later } }, failed)?.primary?.onSelect();
    expect(failed).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(failed).toHaveBeenCalledTimes(1);
    });
    expect(failed.mock.calls[0]?.[0]).toBe(error);
  });

  it('reports nothing for a promise that resolves', async () => {
    const failed = reporter();
    const fine: () => void = async () => undefined;
    guardCommands({ primary: { id: 'a', label: 'Scale', onSelect: fine } }, failed)?.primary?.onSelect();
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).not.toHaveBeenCalled();
  });

  it('gives a way to ask again that runs the same command again by the same path: a second failure is reported again', () => {
    const failed = reporter();
    const onSelect = vi.fn(throws);
    guardCommands({ primary: { id: 'a', label: 'Scale', onSelect } }, failed)?.primary?.onSelect();
    const retry = failed.mock.calls[0]?.[1];
    retry?.();
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledTimes(2);
    expect(failed.mock.calls[1]?.[0]).toBe(error);
  });

  it('does not let a reporter that throws take the click down: a window must not lose its page to its own error report', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const guarded = guardCommands({ primary: { id: 'a', label: 'Scale', onSelect: throws } }, () => {
      throw new Error('the report failed');
    });
    expect(() => {
      guarded?.primary?.onSelect();
    }).not.toThrow();
    expect(report).toHaveBeenCalledExactlyOnceWith('[page] the report of a failed command failed', expect.any(Error));
    report.mockRestore();
  });
});
