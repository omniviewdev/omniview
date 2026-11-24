import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import type { PageOperation } from './operation';
import { AUTO_CLEAR_MS, HELD_GRACE_MS, PageOperationView } from './PageOperation';

const cancel = vi.fn();
const base: PageOperation = {
  title: 'Scale orders-api',
  state: 'running',
  text: 'Scaling orders-api: 2 of 5 replicas',
  progress: 0.4,
  actions: [{ id: 'cancel', kind: 'cancel', label: 'Cancel', onSelect: cancel }],
};

const view = (operation: Partial<PageOperation> = {}) => <PageOperationView operation={{ ...base, ...operation }} />;
const article = () => screen.getByRole('article');

beforeEach(() => {
  cancel.mockReset();
});

describe('PageOperationView, while the work runs', () => {
  it('is an article named by its severity and the work it reports on, which a script can focus', () => {
    render(view());
    expect(article().getAttribute('aria-label')).toBe('Info: Scale orders-api');
    expect(article().getAttribute('tabindex')).toBe('-1');
    expect(article().getAttribute('data-ov-state')).toBe('running');
  });

  it('says what step it is at, on one line that may be cut and is cut with an ellipsis', () => {
    render(view());
    const phase = screen.getByText('Scaling orders-api: 2 of 5 replicas');
    expect(phase.hasAttribute('data-ov-clip')).toBe(true);
  });

  it('reports measured progress by name and rounds the fractional record to whole percent', () => {
    render(view({ progress: 0.396 }));
    const bar = screen.getByRole('progressbar', { name: 'Scale orders-api' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuetext')).toBe('Scaling orders-api: 2 of 5 replicas');
    expect(bar.getAttribute('data-ov-part')).toBe('progress-bar');
  });

  it('keeps progress between 0 and 100', () => {
    const { rerender } = render(view({ progress: 1.7 }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    rerender(view({ progress: -3 }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('has no value while it does not know how far it is: an indeterminate bar', () => {
    render(view({ progress: 'indeterminate' }));
    const bar = screen.getByRole('progressbar');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('data-ov-indeterminate')).toBe('true');
    expect(bar.getAttribute('data-ov-motion')).toBe('stripe');
  });

  it('draws no bar when it has no progress to show, and still holds the track\'s 4 px so nothing moves', () => {
    const { container } = render(view({ progress: undefined }));
    expect(screen.queryByRole('progressbar')).toBeNull();
    const track = container.querySelector('[data-ov-track]');
    expect(track?.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks a paused bar', () => {
    render(view({ state: 'paused' }));
    expect(screen.getByRole('progressbar').getAttribute('data-ov-paused')).toBe('true');
  });

  it('offers Cancel and nothing else: a running operation has no Dismiss', () => {
    render(view());
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('draws only the cancel command of the record while it runs, whatever else the record holds', () => {
    render(
      view({
        actions: [
          { id: 'open', label: 'Open', onSelect: () => undefined },
          { id: 'cancel', kind: 'cancel', label: 'Stop', onSelect: cancel },
        ],
      }),
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Stop']);
  });

  it('is active while queued and while paused as well', () => {
    for (const state of ['queued', 'paused'] as const) {
      const { unmount } = render(view({ state }));
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
      unmount();
    }
  });
});

describe('PageOperationView, once the work ended', () => {
  const ended = (state: PageOperation['state'], rest: Partial<PageOperation> = {}) =>
    view({ state, progress: undefined, text: 'Scaled orders-api to 5 replicas', actions: [], onDismiss: () => undefined, ...rest });

  it('says what happened in one sentence, and draws no bar, only the reserved track', () => {
    const { container } = render(ended('succeeded'));
    expect(screen.getByText('Scaled orders-api to 5 replicas')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.querySelector('[data-ov-track]')?.getAttribute('aria-hidden')).toBe('true');
    expect(article().getAttribute('data-ov-ended')).toBe('true');
  });

  it('is named by the outcome: Success, Error, Warning, Info', () => {
    const word = (state: PageOperation['state']) => {
      const { unmount } = render(ended(state));
      const label = article().getAttribute('aria-label');
      unmount();
      return label;
    };

    expect(word('succeeded')).toBe('Success: Scale orders-api');
    expect(word('failed')).toBe('Error: Scale orders-api');
    expect(word('unknown')).toBe('Warning: Scale orders-api');
    expect(word('cancelled')).toBe('Info: Scale orders-api');
  });

  it('offers Dismiss, named for the work, and calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(ended('succeeded', { onDismiss }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Scale orders-api' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('has no Dismiss when the caller gave it nothing to call', () => {
    render(ended('succeeded', { onDismiss: undefined }));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws the first command of the record before Dismiss, and no second one', () => {
    const open = vi.fn();
    render(ended('succeeded', { actions: [{ id: 'open', label: 'Open', onSelect: open }, { id: 'other', label: 'Other', onSelect: () => undefined }] }));
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['Open', 'Dismiss: Scale orders-api']);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('paints a Retry as the primary command, and any other command as the plain one', () => {
    const { rerender } = render(ended('failed', { actions: [{ id: 'retry', kind: 'retry', label: 'Retry', onSelect: () => undefined }] }));
    expect(screen.getByRole('button', { name: 'Retry' }).getAttribute('data-ov-variant')).toBe('primary');
    rerender(ended('failed', { actions: [{ id: 'open', kind: 'custom', label: 'Open', onSelect: () => undefined }] }));
    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('data-ov-variant')).toBe('secondary');
  });

  it('keeps a command that cannot apply, focusable, with its reason', () => {
    render(ended('failed', { actions: [{ id: 'retry', kind: 'retry', label: 'Retry', disabledReason: 'Not available after restart.', onSelect: cancel }] }));
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(retry);
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('PageOperationView, the calm outcome clears itself (the mock\'s 8 s)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const ended = (state: PageOperation['state'], onDismiss: () => void) =>
    view({ state, progress: undefined, text: 'Done', actions: [], onDismiss });

  // Time passes inside act, so what the presenter does with it is flushed before the next assertion.
  const advance = (milliseconds: number) => {
    act(() => {
      vi.advanceTimersByTime(milliseconds);
    });
  };

  it('calls onDismiss 8 s after a success, and not before', () => {
    const onDismiss = vi.fn();
    render(ended('succeeded', onDismiss));
    advance(AUTO_CLEAR_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();
    advance(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    advance(60_000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does the same after a cancel, which is as calm', () => {
    const onDismiss = vi.fn();
    render(ended('cancelled', onDismiss));
    advance(AUTO_CLEAR_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('never clears a failure or an outcome that is unknown: they stay until they are dismissed', () => {
    for (const state of ['failed', 'unknown'] as const) {
      const onDismiss = vi.fn();
      const { unmount } = render(ended(state, onDismiss));
      advance(10 * 60_000);
      expect(onDismiss, state).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('never clears work that is still going', () => {
    const onDismiss = vi.fn();
    render(view({ onDismiss }));
    advance(10 * 60_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not clear while the pointer or the focus is in it, and tries again after the grace', () => {
    const onDismiss = vi.fn();
    render(
      view({
        state: 'succeeded',
        progress: undefined,
        text: 'Done',
        actions: [{ id: 'open', label: 'Open', onSelect: () => undefined }],
        onDismiss,
      }),
    );
    const open = screen.getByRole('button', { name: 'Open' });
    act(() => {
      open.focus();
    });
    advance(AUTO_CLEAR_MS);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      open.blur();
    });
    advance(HELD_GRACE_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('forgets the clock when the work starts again (a retry), and when the part goes away', () => {
    const onDismiss = vi.fn();
    const { rerender, unmount } = render(ended('succeeded', onDismiss));
    advance(AUTO_CLEAR_MS - 100);
    rerender(view({ onDismiss }));
    advance(AUTO_CLEAR_MS);
    expect(onDismiss).not.toHaveBeenCalled();
    rerender(ended('succeeded', onDismiss));
    unmount();
    advance(AUTO_CLEAR_MS);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('the exact counts of the presenter', () => {
  const count = (element: ReactElement) => {
    const { container, unmount } = render(element);
    const total = container.querySelectorAll('*').length;
    unmount();
    return total;
  };

  it('is a handful of elements in every phase', () => {
    // op, article, main, phase, track, bar, fill, actions, Cancel (button, svg, path)
    expect(count(view())).toBe(11);
    // op, article, main, phase, track, actions, Dismiss (button, svg, path)
    expect(count(view({ state: 'succeeded', progress: undefined, actions: [], onDismiss: () => undefined }))).toBe(9);
  });
});

const css = await readFile(path.join(import.meta.dirname, 'PageOperation.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the PageOperation stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is one 28 px line: the presenter\'s height never changes, whatever it says or offers', () => {
    const notify = rule('.notify');
    expect(notify['block-size']).toBe('var(--ov-control-height)');
    expect(notify['min-block-size']).toBe('var(--ov-control-height)');
    expect(notify.display).toBe('grid');
    expect(notify['grid-template-columns']).toBe('minmax(0, 1fr) auto');
    expect(notify['column-gap']).toBe('var(--ov-spacing-8)');
    expect(notify['align-items']).toBe('center');
  });

  it('stacks the 16 px phase over the 4 px track with a 4 px gap, 24 px in a 28 px cell', () => {
    expect(rule('.main')).toMatchObject({ display: 'grid', 'grid-template-rows': '16px 4px', gap: 'var(--ov-spacing-4)' });
    expect(rule('.phase')).toMatchObject({ 'font-size': 'var(--ov-fs-13)', 'line-height': 'var(--ov-lh-16)', 'white-space': 'nowrap', 'text-overflow': 'ellipsis', overflow: 'hidden' });
    expect(rule('.track')['block-size']).toBe('4px');
    expect(rule('.track[aria-hidden=\'true\']').visibility).toBe('hidden');
  });

  it('lets a finished sentence take the track\'s place on up to two lines, centred in the same 28 px cell', () => {
    expect(rule('.notify[data-ov-ended] > .main')).toMatchObject({ 'grid-template-rows': '32px', 'margin-block': '-2px' });
    expect(rule('.notify[data-ov-ended] .phase')).toMatchObject({ display: '-webkit-box', '-webkit-line-clamp': '2', 'line-clamp': '2', 'white-space': 'normal', 'align-self': 'center' });
    expect(rule('.notify[data-ov-ended] .track').display).toBe('none');
  });

  it('keeps the actions on one line at the end of the cell, 8 px apart', () => {
    expect(rule('.actions')).toMatchObject({ display: 'flex', 'flex-wrap': 'nowrap', 'justify-content': 'flex-end', 'align-items': 'center', gap: 'var(--ov-spacing-8)', 'block-size': 'var(--ov-control-height)' });
  });

  it('uses only tokens for colour and type, and no hex colour', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important/);
  });
});
