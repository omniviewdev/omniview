// The REAL Settings over a host that answers from memory, for the probe (settings-probe.mjs): the shell with the product's own settings control (the gear, the chord, the lazy chunk, the kit's sheet around the one body) or the content of
// the Settings window (the product's `window.tsx` over the product's session, form model and kit parts), with the host's six categories as the Go side declares them (`settings/model/testing.ts`). Only what the host answers is invented. A
// second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it.
//
//   ?case=sheet   (default) the window's shell, an invented plugin's frame behind it, and Settings as the product mounts it where there are no native windows: `window.__control` is the control (open, close, getSnapshot)
//   ?case=window  the Settings window's content alone, as the native window of kind `settings` draws it (and `/?screen=settings-window` in a browser): `window.__windows` is the host's window service in memory (emit a request,
//                 count the hides); the page draws nothing visible until it was told to open: `window.__windows.emit({ requestId, target, visible: true })`, as the host's `OpenSettings` does
//   &host=ok      (default) the host answers at once            &host=held   the first answer waits for `window.__release()`            &host=failed   the first answer fails, the next ones do not
//   &host=down    every answer fails                            &host=empty  the host has no settings
//   &values=<json>  settings that differ from their default, by id (`{"terminal.cursorBlink":false}`)        &stored=<json>  the secrets the host holds, by id (`{"telemetry.auth_value":true}`)
//   &theme=<id>   the theme the document starts in        &request=<json>   the request the window case starts from (a host that was asked to show Settings, on a page)
//
// `window.__host` is the host in memory (its calls, its values, `change`, `listeners()`, `next`); `window.__hold()` makes the NEXT answer of the host wait for `window.__release()`, which is how the probe sees an open before and after
// the data arrives.
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { Button, ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { createRoot } from 'react-dom/client';
import { createSettingsControl, Shell, type ShellRegistration } from '..';
import { deferred, type Deferred } from '../core/fields/testing';
import { fakeHost, fakeWindows, hostSnapshot } from '../settings/model/testing';
import type { HostSnapshot, SettingsClient, SettingsRequest } from '../settings/model/types';
import SettingsWindow from '../settings/window';
import { staticTabs, STATIC_RAIL } from '../testing';

const params = new URLSearchParams(window.location.search);
const CASE = params.get('case') ?? 'sheet';
const HOST = params.get('host') ?? 'ok';
const values = JSON.parse(params.get('values') ?? '{}') as Record<string, unknown>;
const stored = JSON.parse(params.get('stored') ?? '{}') as Record<string, boolean>;
const theme = params.get('theme') ?? undefined;

const host = fakeHost(values, stored);
Reflect.set(window, '__host', host);

// The functions that stop what Settings listens to, in the order it started to listen: the probe calls them to see what a page that stopped listening to its host does (`window.__stops`).
const stops: { readonly changed: Array<() => void>; readonly state: Array<() => void> } = { changed: [], state: [] };
Reflect.set(window, '__stops', stops);
const onChanged = host.client.onChanged;
Object.assign(host.client, {
  onChanged: (listener: () => void) => {
    const stop = onChanged(listener);
    stops.changed.push(stop);
    return stop;
  },
});

// What the next answer waits for: `__hold()` arms it, `__release()` lets it go.
let gate: Deferred<undefined> | undefined;
const arm = (): void => {
  const made = deferred<undefined>();
  gate = made;
  host.next.snapshot = async (): Promise<HostSnapshot> => {
    await made.promise;
    return hostSnapshot(Object.fromEntries(host.values), stored);
  };
};

Reflect.set(window, '__hold', arm);
Reflect.set(window, '__release', () => {
  gate?.resolve(undefined);
  gate = undefined;
});

if (HOST === 'held') {
  arm();
} else if (HOST === 'failed') {
  host.next.snapshot = async () => Promise.reject(new Error('The host did not answer.'));
}

/** The client Settings is given: the host in memory, or one that never answers well, or one with nothing to say. */
const client: SettingsClient =
  HOST === 'down'
    ? {
      ...host.client,
      snapshot: async () => {
        host.calls.snapshot += 1;
        throw new Error('The host did not answer.');
      },
    }
    : HOST === 'empty'
      ? { ...host.client, snapshot: async () => Promise.resolve({ categories: {}, stored: {} }) }
      : host.client;

const registration: ShellRegistration = {
  plugin: { name: 'Acme' },
  rail: STATIC_RAIL,
  sidebar: {
    label: 'Acme resources',
    title: 'Resources',
    nodes: [{ id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'entry', label: 'Entry', icon: 'box', count: 89 }] }],
    open: ['group'],
    current: 'entry',
  },
  scope: [
    { label: 'Connection', icon: 'server', text: 'north' },
    { label: 'Scope', icon: 'folder-tree', text: 'Everything' },
  ],
};

/** The page behind the sheet: a few controls of its own, so that a modal that lets the focus go through is seen to. */
function Behind() {
  return (
    <div data-fixture="behind">
      <p>A page of the window.</p>
      <Button data-fixture="behind-button">Behind</Button>
      <input aria-label="Behind field" defaultValue="behind" />
    </div>
  );
}

const tabs = staticTabs([{ title: 'Entries', icon: 'box', path: ['Acme', 'north', 'Entries'] }]);
const request = JSON.parse(params.get('request') ?? 'null') as SettingsRequest | null;
const windows = fakeWindows(request ?? { requestId: 0, target: '/settings', visible: false });
Reflect.set(window, '__windows', windows);
const onState = windows.client.onState;
Object.assign(windows.client, {
  onState: (listener: (request: SettingsRequest) => void) => {
    const stop = onState(listener);
    stops.state.push(stop);
    return stop;
  },
});

// The control is the window's one, made once and outside any render, as the host makes it: the real lazy chunk of the sheet and the host in memory as its client.
const control = CASE === 'sheet' ? createSettingsControl({ load: async () => import('../settings/surface'), client }) : undefined;
Reflect.set(window, '__control', control);

createRoot(document.getElementById('root')!).render(
  <ThemeProvider themeId={theme}>
    {CASE === 'window' ? <SettingsWindow client={client} windows={windows.client} /> : <Shell registration={registration} tabs={tabs} renderPage={() => <Behind />} empty={null} settings={control} />}
    <TooltipHost />
  </ThemeProvider>,
);
