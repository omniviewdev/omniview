import { act, cleanup, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useRef, type ReactNode } from 'react';
import { vi } from 'vitest';
import type { NoticesOptions } from '../core/notices';
import { makeNotices, manualClock, type Fixture, type ManualClock } from '../core/notices/testing';
import type { ShellRegistration } from '../registration';
import { StaticShell } from '../testing';
import { useRegionKeys } from '../useRegionKeys';
import { createCentre, type Centre } from './centreControl';
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
  const bindings: NoticesBindings = { store: f.store, announcer, ...(options.centre === true ? { centre: createCentre() } : {}) };
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
  vi.useRealTimers();
  shown?.remove();
  shown = undefined;
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

// ---------------------------------------------------------------------------------------------------------------------------
// The whole window: the real shell frame (the status bar with the bell in it), the real centre, the toast layer, the real store over a clock the test drives.

/** The rule that shows a popover in jsdom. */
let shown: HTMLStyleElement | undefined;

/**
 * jsdom has no Popover API: the setup's stand-in (`ui-next/test-setup.ts`) marks an element and nothing shows it, and a popover is `display: none` until a rule says otherwise, which makes it inaccessible to the
 * queries. This is that rule (the Logs toolbar's test has the same); `teardown` takes it away.
 */
export function installPopover(): void {
  if (shown?.isConnected === true) {
    return;
  }

  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
}

export type MountedWindow = {
  readonly f: Fixture;
  readonly clock: ManualClock;
  readonly announcer: NoticesAnnouncer;
  readonly centre: Centre;
  readonly user: UserEvent;
  /** Lets the model tell the view (it tells it at most once a frame) and React draw what it was told. */
  readonly flush: () => Promise<void>;
  /** Moves the model's clock and the page's `Date` together by `ms`: a record's age, the seconds the centre has been open and a toast's life are all read from one time. */
  readonly pass: (ms: number) => Promise<void>;
  readonly unmount: () => void;
};

export type WindowOptions = {
  /** What the store is made with besides the clock and the seam of the fixture. */
  readonly store?: Partial<NoticesOptions>;
  /** The window has no notification centre: no bell, no popover, and the summary toast has no Show. Default: it has one. */
  readonly noCentre?: boolean;
  /** What is drawn in the page, beside the one control the focus can come from. */
  readonly page?: ReactNode;
};

const REGISTRATION: ShellRegistration = { plugin: { name: 'Acme' } };

/**
 * The window over a store: the shell frame with its status bar (where the bell is), the centre, the toast layer. The page's `Date` is the model's clock (`pass` moves both), so that what the centre reads
 * of the time (how long it was open, how old a record is, which day it is under) agrees with what the model decided at the time it was told.
 */
export function mountWindow(options: WindowOptions = {}): MountedWindow {
  installPopover();
  const clock = manualClock();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock.now());
  const announcer = createNoticesAnnouncer();
  const centre = createCentre();
  const f = makeNotices({ announce: announcer.announce, openCenter: options.noCentre === true ? undefined : centre.open, ...(options.store ?? {}) }, clock);
  const notices: NoticesBindings = { store: f.store, announcer, ...(options.noCentre === true ? {} : { centre }) };
  const view = render(
    <StaticShell registration={REGISTRATION} notices={notices}>
      <button type="button">Inside the page</button>
      {options.page}
    </StaticShell>,
  );
  const flush = async (): Promise<void> => {
    await act(async () => {
      await clock.advance(16);
      vi.setSystemTime(clock.now());
    });
  };

  // A person acts and a frame goes by: the model tells its listeners at most once a frame, and on a clock that stands still the frame would never end.
  const base = userEvent.setup();
  const user: UserEvent = {
    ...base,
    click: async (element) => {
      await base.click(element);
      await flush();
    },
    keyboard: async (keys) => {
      await base.keyboard(keys);
      await flush();
    },
    tab: async (options) => {
      await base.tab(options);
      await flush();
    },
  };
  return {
    f,
    clock,
    announcer,
    centre,
    user,
    flush,
    pass: async (ms) => {
      await act(async () => {
        await clock.advance(ms);
        vi.setSystemTime(clock.now());
      });
    },
    unmount: view.unmount,
  };
}
