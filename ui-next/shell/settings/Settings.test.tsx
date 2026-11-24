import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Gear } from './Gear';
import { SettingsProvider } from './context';
import { createSettingsControl, type SettingsControl, type SurfaceModule, type SurfaceProps } from './host';
import { fakeSession } from './model/testing';
import { Settings } from './Settings';

// The always-loaded part of Settings in a window: the chord, the gear, and the sheet's mounting while it is open. The sheet itself is a stand-in here (a dialog with a Close): what it draws is `view/`'s, and what a modal does in a real
// engine, the top layer and an inert document, is the probe's to prove.

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
};

function Stand({ onClose }: SurfaceProps) {
  return (
    <div role="dialog" aria-label="Settings" aria-modal="true">
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

const module: SurfaceModule = { Surface: Stand, createSession: () => fakeSession() };

function mount(platform = 'MacIntel'): { readonly control: SettingsControl; readonly opener: HTMLButtonElement } {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  const control = createSettingsControl({ load: async () => module });
  const opener = document.createElement('button');
  opener.textContent = 'Elsewhere';
  document.body.append(opener);
  render(
    <SettingsProvider settings={control}>
      <Settings />
      <Gear />
    </SettingsProvider>,
  );
  return { control, opener };
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('a closed Settings', () => {
  it('draws nothing but the gear, and holds one listener on the window, the chord\'s', () => {
    const add = vi.spyOn(window, 'addEventListener');
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(add.mock.calls.filter(([type, , options]) => type === 'keydown' && options === true)).toHaveLength(1);
  });

  it('draws the gear as the mock\'s settings glyph', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Settings' }).querySelector('svg')).toHaveAttribute('data-ov-glyph', 'settings');
  });
});

describe('the chord', () => {
  it('opens the sheet with Command comma on a Mac, from anywhere, and the key is Settings\' alone', async () => {
    const { opener } = mount();
    opener.focus();
    const later = vi.fn();
    document.addEventListener('keydown', later);
    const user = userEvent.setup();
    await user.keyboard('{Meta>}[Comma]{/Meta}');
    await flush();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    // Nothing after the window's capture listener saw the comma (the Meta key's own press is another event, and goes where it goes).
    expect(later.mock.calls.filter(([event]) => event instanceof KeyboardEvent && event.code === 'Comma')).toHaveLength(0);
    document.removeEventListener('keydown', later);
  });

  it('opens it with Control comma elsewhere, and with Control Option comma in a browser', async () => {
    mount('Win32');
    const user = userEvent.setup();
    await user.keyboard('{Control>}[Comma]{/Control}');
    await flush();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('opens the sheet once however long the key is held and however often it is pressed while it is open', async () => {
    const { control } = mount();
    const open = vi.spyOn(control, 'open');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma', metaKey: true, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma', metaKey: true, repeat: true, bubbles: true, cancelable: true }));
    await flush();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma', metaKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('is a key like any other in an IME composition: it opens nothing', async () => {
    mount();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma', metaKey: true, isComposing: true, bubbles: true, cancelable: true }));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('an open sheet is a modal over the window', () => {
  async function opened(): Promise<void> {
    mount();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma', metaKey: true, bubbles: true, cancelable: true }));
    await flush();
  }

  it('takes the window\'s own chords from the page behind it: close and jump to a tab, toggle the panel, the palette', async () => {
    await opened();
    for (const code of ['KeyW', 'Digit2', 'KeyJ', 'KeyK']) {
      const event = new KeyboardEvent('keydown', { code, key: code.replace('Key', '').toLowerCase(), metaKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented, code).toBe(true);
    }
  });

  it('leaves them alone while it is closed: they are the page\'s', () => {
    mount();
    const event = new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('closes with the control, and a closed sheet draws nothing and holds the one listener again', async () => {
    await opened();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the gear', () => {
  it('opens the sheet, and the focus goes back to it when the sheet closes', async () => {
    mount();
    const gear = screen.getByRole('button', { name: 'Settings' });
    const user = userEvent.setup();
    await user.click(gear);
    await flush();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(gear).toHaveFocus();
  });

  it('says its chord to assistive technology and in its tip, written for the platform', () => {
    mount();
    const gear = screen.getByRole('button', { name: 'Settings' });
    expect(gear).toHaveAttribute('aria-keyshortcuts', 'Meta+,');
    expect(gear.getAttribute('data-ov-tip')).toBe('Settings\n⌘,');
    expect(gear).toHaveAttribute('aria-haspopup', 'dialog');
  });
});
