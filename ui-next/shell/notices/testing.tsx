import { act, cleanup, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useRef, type ReactNode } from 'react';
import { vi } from 'vitest';
import type { NoticesOptions } from '../core/notices';
import { makeNotices, manualClock, type Fixture, type ManualClock } from '../core/notices/testing';
import { useRegionKeys } from '../useRegionKeys';
import { NoticesProvider } from './context';
import { createNoticesAnnouncer, type NoticesAnnouncer, type NoticesBindings } from './host';
import { Toasts } from './Toasts';

// Test support only: nothing in the product imports this file. The toast layer is read over the real store (on a clock the test drives, `core/notices/testing`), the real announcer and the shell's own region keys;
// what only an engine can say (the geometry, the motion, the stacking, the paint) is the probe's (probes/notices-probe.mjs).

export type Mounted = {
  readonly f: Fixture;
  readonly clock: ManualClock;
  readonly announcer: NoticesAnnouncer;
  readonly bindings: NoticesBindings;
  readonly user: UserEvent;
  /** The button that holds the focus before a toast appears. */
  readonly opener: HTMLButtonElement;
  /** Lets the model tell the view (it tells it at most once a frame) and React draw what it was told. */
  readonly flush: () => Promise<void>;
  readonly unmount: () => void;
};

export type MountOptions = {
  /** The window has a notification centre: the summary toast's Show has somewhere to go. Default: no. */
  readonly centre?: boolean;
  /** What the store is made with besides the clock and the seam of the fixture. */
  readonly store?: Partial<NoticesOptions>;
  /** What is drawn beside the layer (controls the focus can come from). */
  readonly around?: ReactNode;
};

/** The shell's own keys over the DOM of a window: F6 and Escape between regions (`useRegionKeys`), the way the Shell wires them. */
function Window({ children }: { readonly children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useRegionKeys(root);
  return <div ref={root}>{children}</div>;
}

/** The toast layer over a store and a window that has a page and a control the focus can come from. */
export function mount(options: MountOptions = {}): Mounted {
  const clock = manualClock();
  const announcer = createNoticesAnnouncer();
  const f = makeNotices({ announce: announcer.announce, ...(options.centre === true ? {} : { openCenter: undefined }), ...(options.store ?? {}) }, clock);
  const bindings: NoticesBindings = { store: f.store, announcer, centre: options.centre === true };
  const view = render(
    <NoticesProvider notices={bindings}>
      <Window>
        <button type="button">Opener</button>
        {options.around}
        <main data-shell-region="island" data-shell-focus tabIndex={-1} aria-label="Page" />
        <Toasts />
      </Window>
    </NoticesProvider>,
  );
  const opener = document.querySelector<HTMLButtonElement>('button')!;
  return {
    f,
    clock,
    announcer,
    bindings,
    user: userEvent.setup(),
    opener,
    flush: async () => {
      await act(async () => {
        await clock.advance(16);
      });
    },
    unmount: view.unmount,
  };
}

export function teardown(): void {
  cleanup();
  vi.restoreAllMocks();
}

/** The layer: the one live region of the stack (S86). */
export const layerOf = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-notices-part="layer"]');
  if (found === null) {
    throw new Error('no toast layer');
  }

  return found;
};

/** The toasts drawn, in DOM order: the summary toast first when there is one, then the oldest to the newest. */
export const toastsOf = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-notices-part="toast"]')];

/** What a part of a toast says: its text, or, once its words changed, the generated content they are drawn with (`data-text`). */
export const wordsOf = (element: Element | null | undefined): string => element?.getAttribute('data-text') ?? element?.textContent ?? '';
