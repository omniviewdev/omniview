import { useTheme } from '@omniviewdev/kit';
import type { AppearanceSnapshot } from '@omniviewdev/runtime/api';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppearanceCapabilities, WindowAppearance, type AppearanceSource } from './appearance';

const root = document.documentElement;

function snapshot(revision: number, preferences: Partial<AppearanceSnapshot['preferences']> = {}, material: Partial<AppearanceSnapshot['material']> = {}): AppearanceSnapshot {
  return {
    revision,
    preferences: { windowMaterial: 'glass', glassStyle: 'clear', chromeOpacity: 62, contentOpacity: 94, menuOpacity: 90, sheetOpacity: 96, theme: 'light', density: 'compact', textSize: '110', ...preferences },
    material: { effective: 'in-page', glass: false, translucent: true, forcedOpaque: false, reason: 'unsupported', ...material },
  };
}

function client() {
  const read = vi.fn<AppearanceSource['read']>();
  let changed: ((revision: number) => void) | undefined;
  let reconnected: (() => void) | undefined;
  const source: AppearanceSource = {
    read,
    changed: (listener) => {
      changed = listener;
      return () => {
        changed = undefined;
      };
    },
    reconnect: (listener) => {
      reconnected = listener;
      return () => {
        reconnected = undefined;
      };
    },
  };
  return { source, read, change: (revision: number) => changed?.(revision), reconnect: () => reconnected?.() };
}

function Consumer() {
  const { activeTheme } = useTheme();
  const { glass, forcedOpaque } = useAppearanceCapabilities();
  return <output>{`${activeTheme.id}:${glass ? 'glass' : 'no-glass'}:${forcedOpaque ? 'forced' : 'normal'}`}</output>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('committed window appearance', () => {
  it('paints the per-window fallback, uses the persisted theme axes, and changes pure tint without a React commit', async () => {
    const fx = client();
    const commits = vi.fn();
    fx.read.mockResolvedValue(snapshot(1));
    render(<WindowAppearance source={fx.source}><Profiler id="shell" onRender={commits}><Consumer /></Profiler></WindowAppearance>);
    await screen.findByText('light:no-glass:normal');
    expect(root).toHaveAttribute('data-ov-theme', 'light');
    expect(root).toHaveAttribute('data-ov-density', 'compact');
    expect(root).toHaveAttribute('data-ov-text-size', '110');
    expect(root).toHaveAttribute('data-ov-material', 'in-page');
    const before = commits.mock.calls.length;
    const style = root.getAttribute('style');
    fx.read.mockResolvedValue(snapshot(2, { chromeOpacity: 0, contentOpacity: 100, menuOpacity: 1, sheetOpacity: 99 }));
    await act(async () => {
      fx.change(2);
    });
    expect(root).toHaveAttribute('data-ov-chrome-opacity', '0');
    expect(root).toHaveAttribute('data-ov-content-opacity', '100');
    expect(root).toHaveAttribute('data-ov-menu-opacity', '1');
    expect(root).toHaveAttribute('data-ov-sheet-opacity', '99');
    expect(root.getAttribute('style')).toBe(style);
    expect(commits).toHaveBeenCalledTimes(before);
    await act(async () => {
      fx.change(1);
      fx.change(2);
    });
    expect(fx.read).toHaveBeenCalledTimes(2);
  });

  it('rejects a superseded startup read, keeps committed paint on failure, and accepts a restarted host on reconnect', async () => {
    const fx = client();
    const delayed = Promise.withResolvers<AppearanceSnapshot>();
    fx.read.mockReturnValueOnce(delayed.promise);
    const mounted = render(<WindowAppearance source={fx.source}><Consumer /></WindowAppearance>);
    await waitFor(() => {
      expect(fx.read).toHaveBeenCalledTimes(1);
    });
    expect(root).not.toHaveAttribute('data-ov-material');
    fx.read.mockResolvedValueOnce(snapshot(6, { chromeOpacity: 42 }));
    await act(async () => {
      fx.change(6);
    });
    expect(root).toHaveAttribute('data-ov-chrome-opacity', '42');
    await act(async () => {
      delayed.resolve(snapshot(5));
    });
    expect(root).toHaveAttribute('data-ov-chrome-opacity', '42');
    fx.read.mockRejectedValueOnce(new Error('unavailable'));
    await act(async () => {
      fx.change(7);
    });
    expect(root).toHaveAttribute('data-ov-chrome-opacity', '42');
    fx.read.mockResolvedValueOnce(snapshot(1, { chromeOpacity: 13 }));
    await act(async () => {
      fx.reconnect();
    });
    expect(root).toHaveAttribute('data-ov-chrome-opacity', '13');
    mounted.unmount();
    await act(async () => {
      fx.change(2);
      fx.reconnect();
    });
    expect(fx.read).toHaveBeenCalledTimes(4);
    expect(root).not.toHaveAttribute('data-ov-material');
  });

  it('keeps a not-ready window solid and recovers a missed native transition when shown again', async () => {
    const fx = client();
    fx.read.mockResolvedValueOnce(snapshot(1, {}, { effective: 'opaque', reason: 'not-ready' }));
    render(<WindowAppearance source={fx.source}><Consumer /></WindowAppearance>);
    await waitFor(() => expect(root).toHaveAttribute('data-ov-material', 'opaque'));
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fx.read.mockResolvedValueOnce(snapshot(2, {}, { effective: 'glass', glass: true, reason: '' }));
    await act(async () => {
      fx.change(2);
    });
    expect(fx.read).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(fx.read).toHaveBeenCalledTimes(2);
    expect(root).toHaveAttribute('data-ov-material', 'glass');
    expect(screen.getByText('light:glass:normal')).toBeInTheDocument();
  });

  it('reacts to local accessibility and high-contrast themes without mutating the saved surface values', async () => {
    const fx = client();
    const events = new EventTarget();
    let solid = false;
    const media = window.matchMedia('test');
    Object.defineProperty(media, 'matches', { get: () => solid });
    Object.assign(media, { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
    vi.spyOn(window, 'matchMedia').mockReturnValue(media);
    fx.read.mockResolvedValueOnce(snapshot(1));
    render(<WindowAppearance source={fx.source}><Consumer /></WindowAppearance>);
    await screen.findByText('light:no-glass:normal');
    solid = true;
    act(() => {
      events.dispatchEvent(new Event('change'));
    });
    expect(screen.getByText('light:no-glass:forced')).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ov-material', 'opaque');
    expect(root).toHaveAttribute('data-ov-chrome-opacity', '62');
    solid = false;
    act(() => {
      events.dispatchEvent(new Event('change'));
    });
    expect(root).toHaveAttribute('data-ov-material', 'in-page');
    expect(fx.read).toHaveBeenCalledTimes(1);
    fx.read.mockResolvedValueOnce(snapshot(2, { theme: 'high-contrast-dark' }));
    await act(async () => {
      fx.change(2);
    });
    expect(screen.getByText('high-contrast-dark:no-glass:forced')).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ov-material', 'opaque');
  });
});
