import { act, cleanup, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { vi, type Mock } from 'vitest';
import { manualClock, type ManualClock } from '../core/fields/testing';
import { installDialog } from '../palette/testing';
import type { PageMemory } from './host';
import { createSettingsSession, type SettingsSession } from './model/session';
import { fakeHost, type FakeHost } from './model/testing';
import type { HostSnapshot } from './model/types';
import { Surface } from './view/Surface';

// Test support only: nothing in the product imports this file. The Settings sheet is read over the real session, the real form model and the real kit parts, with a host that answers from memory (`model/testing.ts`); only the
// browser's modal dialog is a stand-in, because jsdom has none (what a modal does in a real engine, the top layer and an inert document, is the probe's to prove).

export type Mounted = {
  readonly host: FakeHost;
  readonly session: SettingsSession;
  readonly clock: ManualClock;
  readonly user: UserEvent;
  readonly onClose: Mock<() => void>;
  readonly page: PageMemory & { readonly last: () => string | undefined };
  readonly unmount: () => void;
};

export type MountOptions = {
  readonly values?: Record<string, unknown>;
  readonly stored?: Record<string, boolean>;
  /** The page the sheet was last on in this window. */
  readonly page?: string;
  /** What the host answers to the first question, when it is not its snapshot: a promise the test settles by hand, or a failure. */
  readonly first?: () => Promise<HostSnapshot>;
};

/** Lets what the session and the form model started settle: the host's answers and the model's own promises. */
export async function settle(clock: ManualClock): Promise<void> {
  await act(async () => {
    await clock.flush();
  });
}

/** The sheet over a host in memory, read ready: the first snapshot has arrived. */
export async function mount(options: MountOptions = {}): Promise<Mounted> {
  installDialog();
  const host = fakeHost(options.values ?? {}, options.stored ?? {});
  host.next.snapshot = options.first;
  const clock = manualClock();
  const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
  let remembered: string | undefined = options.page;
  const page = {
    get: () => remembered,
    set: (id: string) => {
      remembered = id;
    },
    last: () => remembered,
  };
  const onClose = vi.fn();
  const view = render(<Surface session={session} page={page} onClose={onClose} />);
  await settle(clock);
  return { host, session, clock, user: userEvent.setup(), onClose, page, unmount: view.unmount };
}

export function teardown(): void {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
}
