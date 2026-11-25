import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { NOT_RUNNING, PLUGIN_STOPPED, rowOf, STOP_WAITING, type Facts, type Forward } from './model';
import { portsMenu, type PortsActions } from './portsMenu';

// The row's context menu as data: the three actions of the row's buttons, in the same order and with the same words, each unavailable for the reason its button gives. Pure, so that its test can read it whole. The hook that gives the
// items to the window's menu host is the table's (`PortsTable.tsx`).

const forward = (patch: Partial<Forward> = {}): Forward => ({
  id: 'forward-1',
  plugin: 'acme',
  connection: 'conn-1',
  kind: 'resource',
  resource: 'web-1',
  local: 8081,
  remote: 8080,
  protocol: 'TCP',
  state: 'running',
  created: 0,
  ...patch,
});

const facts = (patch: Partial<Facts> = {}): Facts => ({ stopping: false, pluginStopped: false, failure: undefined, connectionName: undefined, ...patch });

type Act = (id: string, session: number) => void;
type Run = { readonly stop: Mock<Act>; readonly open: Mock<Act>; readonly copy: Mock<Act> };

const actions = (): Run => ({ stop: vi.fn<Act>(), open: vi.fn<Act>(), copy: vi.fn<Act>() });

describe('the menu of a row', () => {
  it('is Stop, Open in browser and Copy address, as the row\'s buttons are, with the glyphs the buttons draw, for a forward that runs over TCP', () => {
    const items = portsMenu(rowOf(forward(), facts()), actions());
    expect(items.map((item) => (item.kind === 'action' ? [item.id, item.label, item.disabled] : [item.kind]))).toEqual([
      ['stop', 'Stop', undefined],
      ['open', 'Open in browser', undefined],
      ['copy', 'Copy address', undefined],
    ]);
    for (const item of items) {
      expect(item.kind === 'action' && item.icon !== undefined && isIconName(item.icon)).toBe(true);
    }
  });

  it('does what the buttons do, for this row and no other', () => {
    const run = actions();
    const items = portsMenu(rowOf(forward({ id: 'forward-9' }), facts({ session: 7 })), run);
    for (const item of items) {
      if (item.kind === 'action') {
        item.onSelect();
      }
    }

    expect(run.stop).toHaveBeenCalledWith('forward-9', 7);
    expect(run.open).toHaveBeenCalledWith('forward-9', 7);
    expect(run.copy).toHaveBeenCalledWith('forward-9', 7);
  });

  it('has no Open in browser for UDP: it is not offered, and not an item with a reason', () => {
    const items = portsMenu(rowOf(forward({ protocol: 'UDP' }), facts()), actions());
    expect(items.map((item) => item.id)).toEqual(['stop', 'copy']);
  });

  it('says why Open in browser and Copy address cannot be used when the forward does not run, and keeps Stop, which removes it', () => {
    const items = portsMenu(rowOf(forward({ state: 'failed' }), facts()), actions());
    expect(items.map((item) => (item.kind === 'action' ? item.disabled : 'x'))).toEqual([undefined, NOT_RUNNING, NOT_RUNNING]);
  });

  it('says that Stop waits, while it does', () => {
    const items = portsMenu(rowOf(forward(), facts({ stopping: true })), actions());
    expect(items[0]).toMatchObject({ id: 'stop', disabled: STOP_WAITING });
  });

  it('says that the plugin stopped, for a forward that cannot be stopped from here', () => {
    const items = portsMenu(rowOf(forward(), facts({ pluginStopped: true })), actions());
    expect(items[0]).toMatchObject({ id: 'stop', disabled: PLUGIN_STOPPED });
  });

  it('names no shortcut: the row\'s actions have no chord, and a menu that drew one would not be named by all that it draws', () => {
    const items = portsMenu(rowOf(forward(), facts()), actions());
    expect(items.every((item) => item.kind !== 'action' || item.shortcut === undefined)).toBe(true);
  });
});
