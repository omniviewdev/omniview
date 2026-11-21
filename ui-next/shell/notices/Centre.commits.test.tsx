import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mountWindow, teardown, type MountedWindow } from './testing';

// What a notice costs the window (O1b-2): React commits ONCE when the model tells the view that a notice arrived, with the centre open (its list, the bell, the live region) and with it closed. The model tells its
// listeners at most once a frame, however many notices came in it, so a burst of fifty is one commit as well. The window's own `Profiler` counts them (`mountWindow().commits`); the production build's costs and the
// development build's commits in a real engine are the probe's (probes/notices-probe.mjs, section `centre`).

afterEach(teardown);

const bell = (): HTMLElement => screen.getByRole('button', { name: /^Notifications/ });
const dialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Notifications' });
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[data-notices-part="row"]')];

async function opened(): Promise<MountedWindow> {
  const m = mountWindow();
  m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
  await m.flush();
  await m.user.click(bell());
  await m.flush();
  return m;
}

describe('what a notice costs the window', () => {
  it('is one commit with the centre open: the list, the bell and the live region change together', async () => {
    const m = await opened();
    m.commits.count = 0;
    m.f.store.notify({ title: 'Timed out', detail: 'The cluster did not answer.', severity: 'error', initiator: 'user', source: 'cloud' });
    await m.flush();
    expect(rows().map((row) => row.querySelector('[data-notices-part="rowTitle"]')?.textContent)).toEqual(['Error: Timed out', 'Success: Snapshot created']);
    expect(bell()).toHaveAccessibleName('Notifications, 2 unread, 1 error');
    expect(m.commits.count).toBe(1);
  });

  it('is one commit for fifty notices that arrive in one frame', async () => {
    const m = await opened();
    m.commits.count = 0;
    for (let index = 0; index < 50; index += 1) {
      m.f.store.notify({ title: `Notice ${index}`, severity: 'info', source: `source-${index}` });
    }

    await m.flush();
    // The first 50 rows are drawn, and the rest are one button away ("Show 1 older").
    expect(rows()).toHaveLength(50);
    expect(screen.getByRole('button', { name: 'Show 1 older' })).toBeInTheDocument();
    expect(m.commits.count).toBe(1);
  });

  it('is one commit when the same failure comes again: the row counts it in place', async () => {
    const m = await opened();
    m.f.store.notify({ title: 'Timed out', severity: 'error', initiator: 'user', source: 'cloud' });
    await m.flush();
    m.commits.count = 0;
    m.f.store.notify({ title: 'Timed out', severity: 'error', initiator: 'user', source: 'cloud' });
    await m.flush();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]?.textContent).toContain('2');
    expect(m.commits.count).toBe(1);
  });
});
