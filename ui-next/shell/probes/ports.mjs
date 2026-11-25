// The sections of the Ports probe (PF1, docs/ui-next/status/PF1.md): the host's tool of port forwards, in a real engine, in both engines at both viewports. The tool is the product's own, behind the real window (ports-fixture.tsx); only the host
// behind it is invented: the networker's two calls, its events, the way to open an address and the names of connections, driven from here (`window.__ports`). The mock's own Ports tool is the reference, read from mock-ports.json, which
// mock-ports-measure.mjs writes (the mock measured in each engine at each viewport, from the tree it names). Every section waits for a state and never for a time: a page that is asked for something is read until it says it
// (`waitForFunction`, which wakes on a frame), a count is a count, and what must not happen is proven after a number of frames and not of milliseconds.
// This file knows nothing of the runner's own internals: ports-run.mjs hands it `check`, `note`, `report`, `runAxe` and the path of axe, and adds its sections, its parts and its negative controls to its own.
//
// THE DATA is one set of forwards in every state the tool says (SET): running over TCP and over UDP, paused, stopped, failed, one the window's Stop was pressed for (Stopping), one whose plugin stopped (Stopped, and a second line that says why), a
// name that is long, a static target, a connection that has a NAME and one that has none. Five of them are forwards of the mock's own measurement (MOCK_ROWS), so that what is compared is the same ports, and they state the host `127.0.0.1` that the
// mock's words for them say, so that the Mapping (its width, and the columns it makes) is the mock's too. The SDK's session states no host, and for a forward that states none the tool says `port <port>`, offers no Open in browser and calls Copy 'Copy port':
// those words are the tool's own, and the sections `hosts` and `reaches` hold them (and the first records how they differ from the mock's). `cache` states 0.0.0.0, a host that is not this computer: it listens on every network interface, so it runs with a second line
// that says that other computers may reach it (PF3), a two-line row like the mock's; the others state none.
//
// Each assertion is ONE `check` of the name the section says; `PORTS_CONTROLS` is each control's fault, in the shape of the runner's own table: `query` is a control of the fixture page (`?control=`, ports-fixture.tsx: the fake host), `init` is run
// in the page before its own scripts, `after` at the `stage` the section names. A control trips the assertion it is named for and none of the others of its section (a control is run for its section alone), and it passes undetected when its
// assertion is removed (ASSERTION_OFF): ports-run.mjs proves both with NEGATIVE_CONTROL=all. Each runs in Chromium: what it proves does not depend on the engine.
//   geometry   the table against the mock's, measured: its five columns in order, the header, the rows, the paddings, the mapping in the code face, the buttons of a row and the footer's count (ports.columns, ports.header, ports.rows,
//              ports.padding, ports.mapping, ports.actions, ports.footer) and where the columns stand against the mock's (ports.layout with no connection named, ports.layoutnames with names, ports.layoutlong with a name wider than the cap)
//   states     what a row says of its forward: the words, the glyphs, the second line, the connection's name, a name that is long (ports.words, ports.icons, ports.reason, ports.names, ports.long)
//   actions    the three buttons of a row: real, named and tipped (ports.buttons), the glyphs (ports.glyphs), unavailable with a reason and calling nothing (ports.disabled), no Open in browser for UDP (ports.udp), Open in browser calls the
//              way to open an address once with `http://<host>:<local>` for a forward that states a host that is this computer (ports.open), Copy address copies `<host>:<local>` once and says it once (ports.copy), Stop asks the host once and the row says Stopping (ports.stop)
//   menu       the row menu: a right click opens it with the items of the row (menu.items), Shift F10 and the Menu key open it with the first item focused (menu.keys), Escape gives the keyboard back (menu.escape)
//   keyboard   the commands of a row are one Tab stop (keys.tabstop), the arrows, Home and End move inside it and Tab leaves it (keys.arrows), and when the row that has the keyboard goes the keyboard goes to the next row, else the row
//              before, else the tool's tab, also under the row's own menu (keys.next)
//   empty      the empty, loading and failed states: their words, a busy status and no count while loading, Try again asks once, and no button that starts a forward anywhere (ports.empty, ports.loading, ports.failed), and the
//              hint under the title is the mock's 12 px (ports.hint)
//   footer     the footer's words: `1 forward`, `10 forwards`, and ` · <k> stopping` only while some row is Stopping (ports.footerwords)
//   hosts      what the producer states of where a forward listens (`localhost` or an IP address, as written; anything else is none): the Mapping, and Copy port or Copy address (ports.hosts), and the second line of a running forward that other computers may reach
//              (ports.exposed). The words of a forward that states no host are the tool's own, and how they differ from the mock's is recorded (notes, and `report.numbers`)
//   reaches    where Open in browser is offered, why it is not, and what it opens (ports.reach); what Copy writes and says (ports.endpoint): for every way of stating a host
//   events     the list is read again when the events connection comes back and when the window comes back to a person, and not while the tool is hidden (ports.reconnect, ports.wake)
//   confirm    Open in browser and Copy ask the host once more when they are pressed: what they do for a forward that the host says does not run, and at what address (ports.confirm)
//   idle       a table at rest asks for no timer and no frame and commits nothing (ports.idle)
//   hidden     the tool listens to the host only while it is on screen (ports.hidden)
//   flood      500 events made and 500 closed, each in a task of its own, in at most two commits a frame (ports.flood)
//   axe-table, axe-states, axe-menu   axe-core finds nothing in the table (axe.table), in the loading, failed and empty states (axe.states) and in the open menu (axe.menu)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The mock's Ports tool, measured in each engine at each viewport (mock-ports-measure.mjs): absent until it was run. */
const reference = () => {
  try {
    return JSON.parse(readFileSync(path.join(here, 'mock-ports.json'), 'utf8'));
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------------- the data

const at = (n) => `2026-11-24T10:00:${String(n).padStart(2, '0')}Z`;
const LONG = `payments-service-deployment-7d8c6f49b-f8q4m-${'with-a-very-long-resource-name-that-goes-on-'.repeat(4)}and-must-be-cut`;
/** A forward as the host's runtime hands it over (a session): `resource` is the id of the resource, `at` when it was made. The connection `conn-1` of the plugin `acme` has a name (NAMES), `conn-2` of `other` has one, `conn-x` has none. */
const forward = (id, resource, when, patch = {}) => ({
  id,
  created_at: at(when),
  connection_type: 'RESOURCE',
  connection: { plugin_id: 'acme', connection_id: 'conn-1', resource_id: resource, resource_key: 'widgets' },
  protocol: 'TCP',
  state: 'ACTIVE',
  local_port: 8081,
  remote_port: 8080,
  ...patch,
});

/**
 * The host the five forwards of the mock's own measurement state (the mock's words for them read `127.0.0.1:<port>`): so that their Mapping, the width of it and the columns it makes are the mock's, every comparison with the mock keeps its meaning. The SDK's
 * session states no host, so the tool says `port <port>` and does not offer Open in browser for a forward with none: those words are the tool's own and the section `hosts` holds them (and records how they differ from the mock's). The other forwards state none,
 * but `cache`, which states a host that is not this computer.
 */
const HOST = '127.0.0.1';
/** The forwards of the probe, in the order they were made. The ids are what a row is told by (`data-ports-id`). */
export const SET = [
  forward('api', 'api-server', 1, { local_host: HOST }),
  forward('dns', 'dns-cache', 2, { protocol: 'UDP', local_port: 5353, remote_port: 53 }),
  forward('jobs', 'batch-jobs', 3, { state: 'PAUSED', local_port: 9100, remote_port: 9100 }),
  forward('gateway', 'old-gateway', 4, { state: 'STOPPED', local_host: HOST, local_port: 8090, remote_port: 80 }),
  forward('proxy', 'broken-proxy', 5, { state: 'FAILED', local_host: HOST, local_port: 8082, remote_port: 80 }),
  forward('worker', 'batch-worker', 6, { local_host: HOST, local_port: 9000, remote_port: 9000 }),
  forward('payments', LONG, 7, { local_host: HOST, local_port: 8100, remote_port: 8100 }),
  forward('queue', 'queue-broker', 8, { connection: { plugin_id: 'other', connection_id: 'conn-2', resource_id: 'queue-broker', resource_key: 'widgets' }, local_port: 5672, remote_port: 5672 }),
  forward('db', '', 9, { connection_type: 'STATIC', connection: { address: 'db.internal:5432' }, local_port: 6543, remote_port: 5432 }),
  forward('cache', 'cache', 10, { connection: { plugin_id: 'acme', connection_id: 'conn-x', resource_id: 'cache', resource_key: 'widgets' }, local_host: '0.0.0.0', local_port: 8110, remote_port: 6379 }),
];
/**
 * The five forwards of the mock's own measurement (MOCK_ROWS), each of a connection that has a name, with the widest resource name that the mock's own cut gives (43 characters, as its 44-character clip of the long name): the data of the layout
 * with names. The mock shares the free room between Resource and a Connection that has names in proportion to what each needs, so the widest names must be the mock's (the long name of SET is far wider than its cut, and would take all of it).
 */
const byId = (id) => SET.find((entry) => entry.id === id);
/** A host as it is written before a port: an IPv6 host is in brackets. */
const bracketed = (host) => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host);
/** What names a forward's local end, as the tool says it: its host and port when the producer states a host, the port alone when it does not, nothing while the port is not assigned. */
const endpointOf = (entry) => (entry.local_port === 0 ? '' : (entry.local_host ?? '') === '' ? String(entry.local_port) : `${bracketed(entry.local_host)}:${String(entry.local_port)}`);
/** The Mapping of a forward: `port <port> → :<remote>/<protocol>`, `<host>:<port> → …` when the producer states a host, `Auto → …` while the port is not assigned. */
const mappingOf = (entry) => `${entry.local_port === 0 ? 'Auto' : (entry.local_host ?? '') === '' ? `port ${String(entry.local_port)}` : endpointOf(entry)} → :${String(entry.remote_port)}/${entry.protocol}`;
/** What the tool calls Copy for a forward of SET: Copy address for one that listens on this computer (SET's `HOST`), Copy port for every other (none stated, or every interface). */
const copyLabelOf = (id) => (byId(id).local_host === HOST ? 'Copy address' : 'Copy port');
/** The items of a row's menu, and the names of its buttons: Stop, Open in browser (not for UDP) and Copy. */
const labelsOf = (id) => (byId(id).protocol === 'UDP' ? ['Stop', copyLabelOf(id)] : ['Stop', 'Open in browser', copyLabelOf(id)]);
export const NAMED_FIVE = [byId('api'), byId('gateway'), byId('proxy'), byId('worker'), { ...byId('payments'), connection: { ...byId('payments').connection, resource_id: 'payments-service-deployment-7d8c6f49b-f8q4m' } }];
/**
 * How far from the mock's proportion the columns with names may stand. Resource and Connection share the room in proportion to what each asks for: the mock asks 293 px for a Resource (its 44-character cut and the insets) and 86 for a Connection (its
 * header); the tool asks 262 for a Resource whose name is wider than its cap (240 px and the insets) and 92 for a Connection (its floor), so Connection gets more of the room: 34 px more at 1440 and 28 at 1280, the same to 0.02 px in both engines
 * (the proportion is exact in both: the tool's numbers follow from its own two weights). A Connection fitted to its names or one that takes all the room is 100 px or more away; a name that weighs its width leaves Connection at its floor, 135 px away.
 */
const NAMED_TOLERANCE = 40;
/** The five forwards again with the long name of SET (236 characters, far wider than the cap on the weight of a Resource cell). */
export const LONG_FIVE = [...NAMED_FIVE.slice(0, 4), byId('payments')];

/** The names the window knows for its connections. `conn-x` has none, and a row of it says so. */
const NAMES = [
  ['acme', 'conn-1', 'Staging'],
  ['other', 'conn-2', 'Production'],
];
/** The ids of connections the table must never draw. */
const CONNECTION_IDS = ['conn-1', 'conn-2', 'conn-x'];
/** The forwards the mock's own measurement has, by the row of its table: the same names, ports and states (MOCK_ROWS: api-server running, old-gateway stopped, broken-proxy failed, batch-worker stopping, the long name). */
const MOCK_ROWS = { api: 0, gateway: 1, proxy: 2, worker: 3, payments: 4 };
/** The rows that are one line of the mock's size: no second line, and not a row the window made taller (`cache` says that other computers may reach it, on a second line, as `queue` says why it stopped). */
const LINES = ['api', 'dns', 'jobs', 'gateway', 'proxy', 'worker', 'payments', 'db'];
const COLUMNS = ['Resource', 'Mapping', 'Connection', 'Status', 'Actions'];
const KEYS = ['resource', 'mapping', 'connection', 'status', 'actions'];
/** What the mock's glyphs are called in the kit's registry: the mock's own roles name the glyph of a state (`H.statusRoles`), and the registry names its own. */
const GLYPH_OF = { LuPlay: 'play', LuCircleMinus: 'circle-minus', IntUiError: 'status-error', LuLoaderCircle: 'loader-circle' };
const REASON_PLUGIN = 'Its plugin stopped.';
const NOT_RUNNING = 'The forward must be running.';
const NO_PORT = 'The local port is not assigned yet.';
/** Why Open in browser is unavailable for a forward whose producer states no host (every forward the SDK reports today), and for one that listens beyond this computer: the tool shows what the producer states and makes no address up. */
const OPEN_UNSTATED = 'Where this forward listens is not stated, so it cannot be opened from here.';
const OPEN_BEYOND = 'This forward listens beyond this computer, so it is not opened from here.';
/** What a running forward says of itself when other computers may reach it: the producer states that it listens on every network interface, or on an address (as stated, with no brackets). */
const EVERYWHERE = 'Reachable from other computers: it listens on every network interface.';
const ELSEWHERE = (host) => `Reachable from other computers: it listens on ${host}.`;

// ---------------------------------------------------------------------------------------------------- what the page is given before its own scripts

/**
 * The clipboard of the page, deterministic: what the page writes is kept (`window.__clip.writes`). `twice` is given to the script (`addInitScript` passes it) and is true only for the negative control that records every write twice: the clipboard and its
 * fault are made in this one script, so that the fault never waits on another script that Playwright does not order against it.
 */
const CLIPBOARD = ({ twice, guess, exposed }) => {
  const clip = (window.__clip = { writes: [] });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        // The control that guesses puts a host before a port that is given alone.
        const digits = /^\d+$/.test(String(text));
        // The control that exposes puts the host of a forward that others may reach (the `h-all` of the section `reaches`) before its port.
        const hosts = { 8101: '0.0.0.0', 8102: '[::]', 8103: '[::ffff:0.0.0.0]', 8104: '192.168.1.5', 8105: '[fe80::1%en0]', 5355: '0.0.0.0' };
        const given = guess && digits ? `127.0.0.1:${String(text)}` : exposed && digits && hosts[String(text)] !== undefined ? `${hosts[String(text)]}:${String(text)}` : String(text);
        clip.writes.push(given);
        if (twice) clip.writes.push(given);
      },
      readText: async () => '',
    },
  });
};

/**
 * Counts what a page asks of the main thread: timers and frames created and fired, only while `window.__count.on`, and the repeating intervals alive at any moment (`active`: an interval started before the count began is still a timer
 * that fires). Installed before the page's own scripts. The probe's own waits use the frame request as it was (`window.__raf0`), so that waiting for a frame is not a frame the page asked for.
 */
const COUNTERS = () => {
  const counts = (window.__count = { on: false, timeout: 0, interval: 0, raf: 0, fired: 0, active: 0 });
  const alive = new Set();
  window.__raf0 = window.requestAnimationFrame.bind(window);
  const wrap = (name, key, repeats) => {
    const original = window[name].bind(window);
    window[name] = (callback, ...args) => {
      if (counts.on) counts[key] += 1;
      const run =
        typeof callback === 'function'
          ? (...inner) => {
              if (counts.on) counts.fired += 1;
              return callback(...inner);
            }
          : callback;
      const id = original(run, ...args);
      if (repeats) {
        alive.add(id);
        counts.active = alive.size;
      }

      return id;
    };
  };
  wrap('setTimeout', 'timeout', false);
  wrap('setInterval', 'interval', true);
  wrap('requestAnimationFrame', 'raf', false);
  // A browser keeps one list of timers for both ways to cancel one: an interval cancelled with clearTimeout is as cancelled as one cancelled with clearInterval.
  const cancel = (original) => (id) => {
    alive.delete(id);
    counts.active = alive.size;
    return original(id);
  };

  window.clearInterval = cancel(window.clearInterval.bind(window));
  window.clearTimeout = cancel(window.clearTimeout.bind(window));
};

/** What the sections read of the page, in the page (`window.__t`), so that it is read in one task: the table with its geometry, the state of a row, the menu, the tooltip, where the keyboard is and what the live region was told. */
const HELPERS = () => {
  const t = (window.__t = {});
  const round = (value) => Math.round(value * 100) / 100;
  const box = (element) => {
    if (!(element instanceof Element) || element.getClientRects().length === 0) return null;
    const rect = element.getBoundingClientRect();
    return [round(rect.x), round(rect.y), round(rect.width), round(rect.height)];
  };

  const css = (element, props) => (element instanceof Element ? Object.fromEntries(props.map((prop) => [prop, getComputedStyle(element).getPropertyValue(prop)])) : null);
  const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** The box of the words in an element (its text nodes, and not a button or a glyph beside them): where the text starts, which is what the padding of a cell is for. */
  const textBox = (element) => {
    if (!(element instanceof Element)) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.textContent ?? '').trim() === '') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const part of range.getClientRects()) {
        left = Math.min(left, part.left);
        top = Math.min(top, part.top);
        right = Math.max(right, part.right);
        bottom = Math.max(bottom, part.bottom);
      }
    }

    return left === Infinity ? null : [round(left), round(top), round(right - left), round(bottom - top)];
  };

  const textWidth = (element) => textBox(element)?.[2] ?? null;
  const TEXT = ['font-family', 'font-size', 'font-weight', 'line-height', 'color'];
  const PAD = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
  const BORDER = ['border-bottom-width', 'border-bottom-color', 'border-bottom-style', 'background-color', 'position', 'top'];
  const paints = (svg) => [...new Set([...(svg?.querySelectorAll('path, circle, rect') ?? [])].flatMap((shape) => [getComputedStyle(shape).fill, getComputedStyle(shape).stroke]).filter((value) => value !== 'none' && value !== ''))].sort();
  /** What a control is described by: the words of the elements its `aria-describedby` names, without the tooltip (which is there only while it is shown). */
  const described = (element) =>
    (element.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id))
      .filter((node) => node !== null && node.getAttribute('role') !== 'tooltip')
      .map((node) => text(node))
      .join(' ');

  t.body = () => document.querySelector('[data-shell-part="portsBody"]');
  t.table = () => t.body()?.querySelector('table') ?? null;
  t.rows = () => [...(t.table()?.querySelectorAll('tbody tr') ?? [])];
  t.ids = () => t.rows().map((row) => row.dataset.portsId);
  t.row = (id) => t.rows().find((row) => row.dataset.portsId === id) ?? null;
  t.stateOf = (id) => t.row(id)?.dataset.portsState ?? null;
  t.live = () => t.body()?.querySelector('[data-ports-part="live"]')?.textContent ?? '';
  /** The words of the count in the footer: the element with no child that says how many forwards. */
  t.count = () => {
    const footer = t.body()?.querySelector('[data-ports-part="footer"]');
    return [...(footer?.querySelectorAll('*') ?? [])].find((element) => element.children.length === 0 && /forwards?( · \d+ stopping)?$/.test(text(element))) ?? null;
  };

  t.readRow = (row) => {
    const cells = [...row.children];
    // A cell is found by the column it says it is, and not by its place: the order of the columns is the business of one assertion alone.
    const cellOf = (column) => cells.find((cell) => cell.dataset.column === column);
    const resource = cellOf('resource');
    const mapping = cellOf('mapping');
    const connection = cellOf('connection');
    const state = cellOf('status');
    const actions = cellOf('actions');
    const status = state?.querySelector('[data-ov-role]') ?? null;
    const glyph = status?.querySelector('svg') ?? null;
    const name = resource?.firstElementChild ?? null;
    const reason = resource?.querySelector('[data-ports-part="reason"]') ?? null;
    const span = mapping?.querySelector('[data-ports-part="mapping"]') ?? null;
    const group = actions?.querySelector('[role="group"]') ?? null;
    return {
      id: row.dataset.portsId ?? null,
      state: row.dataset.portsState ?? null,
      rect: box(row),
      cells: cells.map((cell) => ({ column: cell.dataset.column ?? null, rect: box(cell), content: textBox(cell), box: css(cell, PAD), text: css(cell, TEXT) })),
      resource: { text: text(resource?.firstElementChild ?? null), full: text(resource), nameStyle: css(name, TEXT), content: textBox(name), nameBox: box(name), reason: reason === null ? null : { text: text(reason), rect: box(reason), style: css(reason, TEXT) } },
      mapping: { text: text(span), width: textWidth(span), style: css(span, TEXT) },
      connection: { text: text(connection), style: css(connection?.firstElementChild ?? null, TEXT), dash: connection?.querySelector('[role="img"]')?.getAttribute('aria-label') ?? null },
      status: status === null ? null : { role: status.getAttribute('data-ov-role'), word: text(status), rect: box(status), glyph: glyph?.getAttribute('data-ov-glyph') ?? null, icon: box(glyph), label: textBox(status), style: css(status, TEXT), paint: paints(glyph) },
      group: group === null ? null : { rect: box(group), label: group.getAttribute('aria-label'), children: group.children.length, slots: [...group.children].map((child) => `${child.tagName.toLowerCase()}${child.getAttribute('aria-hidden') === 'true' ? ':hidden' : ''}`) },
      buttons: [...(actions?.querySelectorAll('button') ?? [])].map((button) => ({
        label: button.getAttribute('aria-label'),
        action: button.dataset.portsAction ?? null,
        rect: box(button),
        svg: box(button.querySelector('svg')),
        glyph: button.querySelector('svg')?.getAttribute('data-ov-glyph') ?? null,
        tabindex: button.getAttribute('tabindex'),
        disabled: button.getAttribute('aria-disabled') === 'true',
        native: button.disabled,
        tip: button.getAttribute('data-ov-tip'),
        description: described(button),
        type: button.getAttribute('type'),
      })),
    };
  };

  /** The table as the geometry sections read it: the panel around it, the header, every row and the footer. */
  t.read = () => {
    const body = t.body();
    const table = t.table();
    const footer = body?.querySelector('[data-ports-part="footer"]') ?? null;
    const count = t.count();
    return {
      panel: box(document.querySelector('[data-shell-part="panel"]')),
      body: box(body),
      table: box(table),
      columns: [...(table?.querySelectorAll('thead th') ?? [])].map((cell) => {
        const rect = cell.getBoundingClientRect();
        const whole = table.getBoundingClientRect();
        return { column: cell.dataset.column ?? null, x: round(rect.x), width: round(rect.width), fromRight: round(whole.right - rect.x) };
      }),
      tableName: table?.getAttribute('aria-label') ?? null,
      head: {
        rect: box(table?.querySelector('thead tr') ?? null),
        cells: [...(table?.querySelectorAll('thead th') ?? [])].map((cell) => ({ column: cell.dataset.column ?? null, text: text(cell), rect: box(cell), content: textBox(cell), box: css(cell, PAD), style: css(cell, TEXT), border: css(cell, BORDER), hidden: box(cell.querySelector('span')) })),
      },
      rows: t.rows().map((row) => t.readRow(row)),
      scroll: table?.parentElement instanceof Element ? { client: [table.parentElement.clientWidth, table.parentElement.clientHeight], scroll: [table.parentElement.scrollWidth, table.parentElement.scrollHeight] } : null,
      footer: footer === null ? null : { rect: box(footer), text: text(footer), count: count === null ? null : { text: text(count), rect: box(count), content: textBox(count), style: css(count, TEXT) }, box: css(footer, [...PAD, 'min-height', 'border-top-width', 'border-top-color', 'background-color']) },
    };
  };

  /** Where the keyboard is. */
  t.active = () => {
    const element = document.activeElement;
    if (element === null) return null;
    const row = element.closest('[data-ports-part="row"]');
    return {
      tag: element.tagName,
      label: element.getAttribute('aria-label'),
      role: element.getAttribute('role'),
      row: row?.dataset.portsId ?? null,
      action: element.dataset.portsAction ?? null,
      tab: element.getAttribute('role') === 'tab',
      tabName: element.getAttribute('role') === 'tab' ? text(element) : null,
      menu: element.closest('[role="menu"]') !== null,
      page: element === document.body,
      scroller: t.body() !== null && element.parentElement === t.body() && element.getAttribute('tabindex') === '-1',
      inBody: t.body()?.contains(element) === true,
      item: element.getAttribute('role') === 'menuitem' ? element.getAttribute('aria-label') : null,
    };
  };

  /** The row menu, while it is open: its name, its items (their names, whether each is unavailable, what each is described by) and the item that has the keyboard. */
  t.menu = () => {
    const popup = document.querySelector('[role="menu"]');
    if (popup === null || popup.getClientRects().length === 0) return null;
    return {
      label: popup.getAttribute('aria-label'),
      items: [...popup.querySelectorAll('[role="menuitem"]')].map((item) => ({ label: item.getAttribute('aria-label'), text: text(item), disabled: item.getAttribute('aria-disabled') === 'true', description: item.getAttribute('aria-description') ?? '' })),
      separators: popup.querySelectorAll('[role="separator"]').length,
      focused: document.activeElement?.getAttribute('role') === 'menuitem' ? document.activeElement.getAttribute('aria-label') : null,
    };
  };

  /** The words of the tooltip, while it is shown. */
  t.tip = () => {
    const tip = document.querySelector('[role="tooltip"]');
    return tip !== null && tip.matches(':popover-open') ? text(tip) : null;
  };

  /** What the live region is told, one entry for each node that arrives in it with words (the region replaces its node for each thing said, so a sentence said twice is two). Installed once, when asked. */
  t.watch = () => {
    if (t.told !== undefined) return;
    t.told = [];
    new MutationObserver((list) => {
      // The record says where the nodes were added: one that another announcement has already replaced has no parent by the time the observer runs, and was said all the same.
      for (const record of list) {
        if ((record.target.closest?.('[data-ports-part="live"]') ?? null) === null) continue;
        for (const node of record.addedNodes) if ((node.textContent ?? '') !== '') t.told.push(node.textContent);
      }
    }).observe(document.body, { subtree: true, childList: true });
  };
};

// ---------------------------------------------------------------------------------------------------- the parts and the negative controls

/** The probes of CI, by the sections each runs (ports-a-probe.mjs and its siblings): every section is in one part and only one. */
export const PORTS_PARTS = {
  a: ['geometry', 'states'],
  b: ['actions', 'menu', 'confirm'],
  c: ['keyboard', 'empty', 'footer', 'hosts'],
  d: ['idle', 'hidden', 'flood', 'events'],
  e: ['axe-table', 'axe-states', 'axe-menu', 'reaches'],
};

/** The sections that need the development build, where React's Profiler counts commits. */
export const PORTS_DEVELOPMENT = ['idle', 'flood'];

/** What a control plants in a surface that axe reads: an image with no text alternative (the pattern of the other probes). */
const plantImage = (selector) => (page) =>
  page.evaluate(
    ({ src, target }) => {
      const image = document.createElement('img');
      image.src = src;
      document.querySelector(target).append(image);
    },
    { src: IMAGE, target: selector },
  );

/** A rule of style planted in the loaded page, over the product's own (a rule outside a cascade layer beats any in one). */
const restyle = (content) => (page) => page.addStyleTag({ content });
const TABLE = '[data-shell-part="portsBody"] table';
/** The development build's commits are not counted: what the probe reads of them is a log that takes nothing. */
const UNCOUNTED = () => {
  const dead = [];
  Object.defineProperty(dead, 'push', { value: () => 0 });
  Object.defineProperty(window, '__commits', { configurable: true, get: () => dead, set: () => undefined });
};

export const PORTS_CONTROLS = {
  // The columns: the Status cell and the Connection cell change places, in the header and in every row.
  'columns-swapped': {
    assertion: 'ports.columns',
    section: 'geometry',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        for (const line of document.querySelectorAll('[data-shell-part="portsBody"] table tr')) if (line.children.length === 5) line.insertBefore(line.children[3], line.children[2]);
      }),
  },
  // The header is taller than the mock's 25 px.
  'header-tall': { assertion: 'ports.header', section: 'geometry', stage: 'ready', after: restyle(`${TABLE} th { block-size: 31px !important; }`) },
  // A row is taller than the mock's 24 px: what the Status cell holds is 34 px tall.
  'row-tall': { assertion: 'ports.rows', section: 'geometry', stage: 'ready', after: restyle(`${TABLE} td[data-column="status"] > * { display: inline-block !important; block-size: 34px !important; }`) },
  // The cell of the mapping is padded more than the mock's 10 px on each side.
  'padding-mapping': { assertion: 'ports.padding', section: 'geometry', stage: 'ready', after: restyle(`${TABLE} td[data-column="mapping"] { padding-inline: 14px !important; }`) },
  // The mapping is not set in the code face.
  'mapping-face': { assertion: 'ports.mapping', section: 'geometry', stage: 'ready', after: restyle('[data-ports-part="mapping"] { font-family: Helvetica, Arial, sans-serif !important; }') },
  // The buttons of a row are 12 px apart and not the mock's 8.
  'actions-gap': { assertion: 'ports.actions', section: 'geometry', stage: 'ready', after: restyle(`${TABLE} td[data-column="actions"] [role="group"] { gap: 12px !important; }`) },
  // The footer counts one forward more than the table has.
  'footer-count': {
    assertion: 'ports.footer',
    section: 'geometry',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        const count = window.__t.count();
        if (count !== null) count.textContent = `${String(window.__t.ids().length + 1)} forwards`;
      }),
  },
  // A state said in other words than the host's.
  'word-edited': {
    assertion: 'ports.words',
    section: 'states',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        const status = window.__t.row('jobs')?.querySelector('[data-ov-role]');
        const word = [...(status?.childNodes ?? [])].find((node) => node.nodeType === Node.TEXT_NODE);
        if (word !== undefined) word.textContent = 'Pausing';
      }),
  },
  // The glyph of a failed forward is the glyph of a stopped one.
  'icon-swapped': {
    assertion: 'ports.icons',
    section: 'states',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        const failed = window.__t.row('proxy')?.querySelector('[data-ov-role] svg');
        const stopped = window.__t.row('gateway')?.querySelector('[data-ov-role] svg');
        if (failed !== null && failed !== undefined && stopped !== null && stopped !== undefined) failed.replaceWith(stopped.cloneNode(true));
      }),
  },
  // The second line of a forward whose plugin stopped says another thing, and is not muted.
  'reason-text': {
    assertion: 'ports.reason',
    section: 'states',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        const line = window.__t.row('queue')?.querySelector('[data-ports-part="reason"]');
        if (line !== null && line !== undefined) line.textContent = 'Its plugin ended.';
      }),
  },
  'reason-muted': { assertion: 'ports.reason', section: 'states', stage: 'ready', after: restyle('[data-ports-part="reason"] { color: var(--ov-fg) !important; }') },
  // The connections' names are their ids.
  'names-ids': { assertion: 'ports.names', section: 'states', query: 'control=names-ids' },
  // A name that is long wraps to a second line.
  'long-wraps': { assertion: 'ports.long', section: 'states', stage: 'ready', after: restyle(`${TABLE} td[data-column="resource"] { max-inline-size: none !important; white-space: normal !important; overflow: visible !important; } ${TABLE} td[data-column="resource"] * { white-space: normal !important; }`) },
  // The columns do not stand where the mock's do: Mapping takes a share of the table, Status a width of its own (planted in the page that says no connection's name, which is the one the assertion reads).
  'layout-mapping-wide': { assertion: 'ports.layout', section: 'geometry', stage: 'bare', after: restyle(`${TABLE} :is(th, td)[data-column="mapping"] { inline-size: 45% !important; }`) },
  'layout-status-wide': { assertion: 'ports.layout', section: 'geometry', stage: 'bare', after: restyle(`${TABLE} :is(th, td)[data-column="status"] { inline-size: 200px !important; }`) },
  // With names the Connection column is the mock's text column, which shares the free room with Resource: it is fitted to its names, as it is with none (the state before the share), or it takes all the room.
  'names-fitted': { assertion: 'ports.layoutnames', section: 'geometry', stage: 'named', after: restyle(`${TABLE} :is(th, td)[data-column="connection"] { inline-size: 1% !important; }`) },
  'names-greedy': { assertion: 'ports.layoutnames', section: 'geometry', stage: 'named', after: restyle(`${TABLE} :is(th, td)[data-column="resource"] { inline-size: 1% !important; }`) },
  // The cap on the weight of a Resource cell is gone: a name that is wider than any column weighs its width, and Connection is left at its floor.
  'long-uncapped': { assertion: 'ports.layoutlong', section: 'geometry', stage: 'long', after: restyle(`${TABLE} td[data-column="resource"] { max-inline-size: none !important; }`) },
  // ---- actions
  // A command that has lost its name and its tip.
  'button-nameless': {
    assertion: 'ports.buttons',
    section: 'actions',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        const button = window.__t.row('api')?.querySelector('[data-ports-action="open"]');
        button?.removeAttribute('aria-label');
        button?.removeAttribute('data-ov-tip');
      }),
  },
  // The Copy button draws another glyph than the registry's copy.
  'glyph-wrong': {
    assertion: 'ports.glyphs',
    section: 'actions',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        window.__t.row('api')?.querySelector('[data-ports-action="copy"] svg')?.setAttribute('data-ov-glyph', 'trash');
      }),
  },
  // A command that cannot be used is natively disabled: it cannot be reached by the keyboard, and so cannot say why.
  'disabled-native': {
    assertion: 'ports.disabled',
    section: 'actions',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        window.__t.row('proxy')?.querySelector('[data-ports-action="open"]')?.setAttribute('disabled', '');
      }),
  },
  // A forward over UDP is offered Open in browser: a clone of the button of a TCP row stands in its commands.
  'udp-open': {
    assertion: 'ports.udp',
    section: 'actions',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        const open = window.__t.row('api')?.querySelector('[data-ports-action="open"]');
        const placeholder = window.__t.row('dns')?.querySelector('[role="group"] > span[aria-hidden="true"]');
        if (open !== null && open !== undefined && placeholder !== null && placeholder !== undefined) placeholder.replaceWith(open.cloneNode(true));
      }),
  },
  // The way to open an address is called twice for one press, and with another name for this computer.
  'open-twice': { assertion: 'ports.open', section: 'actions', query: 'control=open-twice' },
  'open-wrong': { assertion: 'ports.open', section: 'actions', query: 'control=open-wrong' },
  // The clipboard is given each address twice; the words that say an address was copied are said twice.
  'copy-twice': { assertion: 'ports.copy', section: 'actions', clipboard: { twice: true } },
  'announce-twice': {
    assertion: 'ports.copy',
    section: 'actions',
    init: () => {
      window.addEventListener('DOMContentLoaded', () => {
        new MutationObserver((list) => {
          for (const record of list) {
            for (const node of record.addedNodes) {
              const live = node.parentElement?.closest('[data-ports-part="live"]') ?? null;
              if (live !== null && node.dataset?.again === undefined && node.textContent === 'Address copied') {
                const again = document.createElement('span');
                again.dataset.again = '';
                again.textContent = node.textContent;
                live.append(again);
              }
            }
          }
        }).observe(document.body, { subtree: true, childList: true });
      });
    },
  },
  // The host's close is called twice for one press, and for another forward than the one the press is on.
  'close-twice': { assertion: 'ports.stop', section: 'actions', query: 'control=close-twice' },
  'close-other': { assertion: 'ports.stop', section: 'actions', query: 'control=close-other' },
  // ---- the row menu
  // An item of the menu is not there.
  'menu-item-missing': {
    assertion: 'menu.items',
    section: 'menu',
    stage: 'open',
    after: (page) =>
      page.evaluate(() => {
        document.querySelector('[role="menu"] [role="menuitem"][aria-label="Open in browser"]')?.remove();
      }),
  },
  // Shift F10 and the Menu key never reach the buttons of a forward over UDP: a window that takes them first there.
  'trigger-keys-lost': {
    assertion: 'menu.keys',
    section: 'menu',
    init: () => {
      window.addEventListener(
        'keydown',
        (event) => {
          if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && document.activeElement?.closest('[data-ports-id="dns"]') !== null) event.stopImmediatePropagation();
        },
        true,
      );
    },
  },
  // The keyboard is left on the page when Escape puts the menu away: it is taken from whatever has it as soon as the menu's own key has run.
  'escape-blurs': {
    assertion: 'menu.escape',
    section: 'menu',
    init: () => {
      window.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Escape') setTimeout(() => document.activeElement?.blur(), 0);
        },
        true,
      );
    },
  },
  // ---- the keyboard
  // A second button of a row is a Tab stop too.
  'tabstop-extra': {
    assertion: 'keys.tabstop',
    section: 'keyboard',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        // Kept so when the row's group settles its stops again, and written only when it is not so already (a write of the value it has is a change the observer would see again).
        const hold = () => {
          const button = window.__t.row('payments')?.querySelector('[data-ports-action="copy"]');
          if (button !== null && button !== undefined && button.getAttribute('tabindex') !== '0') button.setAttribute('tabindex', '0');
        };

        hold();
        new MutationObserver(hold).observe(window.__t.row('payments') ?? document.body, { attributes: true, subtree: true, attributeFilter: ['tabindex'] });
      }),
  },
  // The arrows never reach the row's buttons.
  'arrows-swallowed': {
    assertion: 'keys.arrows',
    section: 'keyboard',
    init: () => {
      window.addEventListener(
        'keydown',
        (event) => {
          if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && document.activeElement?.closest('[data-ports-part="row"]') !== null) event.stopImmediatePropagation();
        },
        true,
      );
    },
  },
  // The keyboard is dropped on the page when the row that had it goes.
  'focus-dropped': {
    assertion: 'keys.next',
    section: 'keyboard',
    init: () => {
      window.addEventListener('DOMContentLoaded', () => {
        new MutationObserver((list) => {
          for (const record of list) for (const node of record.removedNodes) if (node.dataset?.portsPart === 'row') queueMicrotask(() => document.activeElement?.blur());
        }).observe(document.body, { subtree: true, childList: true });
      });
    },
  },
  // ---- the empty, loading and failed states
  // A button that starts a forward stands in the empty state.
  'forward-button': {
    assertion: 'ports.empty',
    section: 'empty',
    stage: 'empty',
    after: (page) =>
      page.evaluate(() => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Forward port…';
        window.__t.body()?.querySelector('[data-shell-part="panelEmpty"]')?.append(button);
      }),
  },
  // A count stands in the body while the host has not answered.
  'loading-count': {
    assertion: 'ports.loading',
    section: 'empty',
    stage: 'loading',
    after: (page) =>
      page.evaluate(() => {
        const count = document.createElement('div');
        count.dataset.portsPart = 'footer';
        count.textContent = '0 forwards';
        window.__t.body()?.append(count);
      }),
  },
  // A press of Try again also tells the tool that a connection changed: it reads twice.
  'retry-twice': {
    assertion: 'ports.failed',
    section: 'empty',
    init: () => {
      window.addEventListener(
        'click',
        (event) => {
          if (event.target instanceof Element && event.target.closest('button')?.textContent === 'Try again') setTimeout(() => window.__ports.emit('connection/status', {}), 0);
        },
        true,
      );
    },
  },
  // The hint of the empty state is 13 px and not the mock's 12.
  'hint-size': { assertion: 'ports.hint', section: 'empty', stage: 'empty', after: restyle('[data-shell-part="portsBody"] [data-shell-part="panelEmpty"] p + p { font-size: 13px !important; }') },
  // A section goes over its limit while it waits for the host's answer, which never comes: one failure that names the section, and nothing from what is left of it (its wait says false when its page goes, and the check after the wait would fail ports.loading).
  'section-timeout': {
    assertion: 'empty.error',
    section: 'empty',
    stage: 'loading',
    after: async (page, origin, ctx) => {
      await page.evaluate(() => {
        window.__ports.reads.answer = () => undefined;
      });
      ctx.limit(3000);
    },
  },
  // The footer says `1 forwards` for one forward, and keeps ` · 1 stopping` when nothing is stopping any more.
  'footer-singular': {
    assertion: 'ports.footerwords',
    section: 'footer',
    stage: 'single',
    after: (page) =>
      page.evaluate(() => {
        const count = window.__t.count();
        if (count !== null) count.textContent = '1 forwards';
      }),
  },
  'footer-suffix-stuck': {
    assertion: 'ports.footerwords',
    section: 'footer',
    stage: 'settled',
    after: (page) =>
      page.evaluate(() => {
        const count = window.__t.count();
        if (count !== null) count.textContent = `${count.textContent ?? ''} · 1 stopping`;
      }),
  },
  // ---- what it costs
  // A timer that goes on at rest, and a component that renders ten times a second.
  'idle-timer': {
    assertion: 'ports.idle',
    section: 'idle',
    stage: 'idle',
    after: (page) =>
      page.evaluate(() => {
        setInterval(() => undefined, 500);
      }),
  },
  'idle-commits': { assertion: 'ports.idle', section: 'idle', query: 'control=idle-commits' },
  // The events the tool listens to are never let go of; a listener of the names is never let go of; the host is asked for the list before the tool is shown.
  'hidden-leak': { assertion: 'ports.hidden', section: 'hidden', query: 'control=hidden-leak' },
  'names-leak': { assertion: 'ports.hidden', section: 'hidden', query: 'control=events-forever' },
  'list-eager': { assertion: 'ports.hidden', section: 'hidden', query: 'control=list-eager' },
  // The window's next frame is the task that asked for it: a commit for each event of a flood.
  'flood-sync': { assertion: 'ports.flood', section: 'flood', query: 'control=flood-sync' },
  // The profiler does not count: a table at rest costs no commit, and a flood is drawn in none, because none is counted.
  'idle-uncounted': { assertion: 'ports.idle', section: 'idle', init: UNCOUNTED },
  'flood-uncounted': { assertion: 'ports.flood', section: 'flood', init: UNCOUNTED },
  // The host lists other forwards when the panel is shown again than the tool draws.
  'hidden-stale': { assertion: 'ports.hidden', section: 'hidden', stage: 'reopen', after: (page) => page.evaluate((sessions) => window.__ports.set(sessions), SET) },
  // The page never tells the tool that its events connection came back; what the tool listens to the window coming back with is never let go of.
  'reconnect-ignored': { assertion: 'ports.reconnect', section: 'events', query: 'control=reconnect-ignored' },
  'wake-leak': { assertion: 'ports.wake', section: 'events', query: 'control=wake-leak' },
  // The host answers every read with the list it gave the first time: a press that reads the list first reads what the host said before.
  'confirm-stale': { assertion: 'ports.confirm', section: 'confirm', query: 'control=confirm-stale' },
  // The tool says a host that the producer does not state: the Mapping of a forward with none reads as the mock's, with a loopback host that nobody said.
  'hosts-guessed': {
    assertion: 'ports.hosts',
    section: 'hosts',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        for (const span of document.querySelectorAll('[data-ports-id="h-none"] [data-ports-part="mapping"]')) span.textContent = '127.0.0.1:8081 → :8080/TCP';
      }),
  },
  // The Copy of a forward that other computers may reach is called Copy address, as the Copy of a forward on this computer is: it is a port that is copied.
  'exposed-copy-label': {
    assertion: 'ports.hosts',
    section: 'hosts',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        document.querySelector('[data-ports-id="h-all"] button[data-ports-action="copy"]')?.setAttribute('aria-label', 'Copy address');
      }),
  },
  // A running forward that other computers may reach says nothing of it: its row has no second line.
  'exposed-line-dropped': {
    assertion: 'ports.exposed',
    section: 'hosts',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        document.querySelector('[data-ports-id="h-all"] [data-ports-part="reason"]')?.remove();
      }),
  },
  // Open in browser is offered for a forward whose producer states no host.
  'reach-unstated': {
    assertion: 'ports.reach',
    section: 'reaches',
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        const button = document.querySelector('[data-ports-id="h-none"] button[data-ports-action="open"]');
        for (const name of ['aria-disabled', 'aria-describedby', 'aria-description']) button?.removeAttribute(name);
      }),
  },
  // Copy puts a host that nobody said before the port it copies.
  'endpoint-guessed': { assertion: 'ports.endpoint', section: 'reaches', clipboard: { guess: true } },
  // Copy writes the host and the port of a forward that other computers may reach, where it is to write the port alone.
  'exposed-copy-address': { assertion: 'ports.endpoint', section: 'reaches', clipboard: { exposed: true } },
  // ---- axe
  'axe-table': { assertion: 'axe.table', section: 'axe-table', stage: 'axe', after: plantImage('[data-probe-axe="table"]') },
  'axe-states': { assertion: 'axe.states', section: 'axe-states', stage: 'axe', after: plantImage('[data-probe-axe="states"]') },
  'axe-menu': { assertion: 'axe.menu', section: 'axe-menu', stage: 'axe', after: plantImage('[data-probe-axe="menu"]') },
  // The unload of the plugin is not told to the tool, so its queue is never stopped: the table is not the one to scan.
  'axe-unstaged': {
    assertion: 'axe.table',
    section: 'axe-table',
    stage: 'staging',
    after: (page) =>
      page.evaluate(() => {
        const { emit } = window.__ports;
        window.__ports.emit = (name, payload) => (name === 'plugin/unloaded' ? undefined : emit.call(window.__ports, name, payload));
      }),
  },
};

// ---------------------------------------------------------------------------------------------------- the sections

/**
 * @param {{ check: Function, note: Function, report: { numbers: Record<string, unknown> }, runAxe: Function, axe: string }} deps
 */
export function createPortsSections({ check, note, report, runAxe, axe }) {
  const sections = {};
  const near = (a, b, tolerance = 0.5) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;
  /** The first family of a font stack, as a person names it (an engine quotes a name with spaces and another does not). */
  const family = (stack) => String(stack ?? '').split(',')[0].replaceAll('"', '').replaceAll("'", '').trim();
  const said = (problems) => (problems.length === 0 ? 'every reading is the mock\'s' : `${String(problems.length)} readings differ: ${problems.slice(0, 5).join('; ')}`);

  /** What a control plants at the stage it names, as the runner's own `perturb` does. */
  const perturb = async (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin, ctx) : undefined);

  /** Whether the page is waited for: `done` is true of the page within `timeout` ms, read on every frame; false when it never was (what the assertion says is then what the page held). */
  const waitFor = async (page, done, arg, timeout = 15_000) =>
    page.waitForFunction(done, arg, { timeout }).then(
      () => true,
      () => false,
    );

  /** Two frames have passed (what the page did with an event is on the screen). The probe's frame request is the page's own as it was before the counters wrapped it, so that a wait is not a frame the page asked for. */
  const frames = async (page, count = 2) =>
    page.evaluate(
      async (n) => {
        // The limit is cleared when the frames arrive: a timer left pending would fire into whatever the probe samples next (the counters of `ports.idle` count a callback that fires as work the page did).
        let timer;
        try {
          return await Promise.race([
            new Promise((resolve) => {
              let left = n;
              const tick = () => {
                left -= 1;
                if (left <= 0) resolve(true);
                else window.__raf0(tick);
              };

              window.__raf0(tick);
            }),
            new Promise((resolve) => {
              timer = setTimeout(() => {
                resolve(false);
              }, 3000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      },
      count,
    );

  /** A page of the fixture (the real window, the Ports tool, the fake host; `dev` is the development build, whose React Profiler counts commits). `fonts` puts the UI face in the one the mock was measured in. */
  async function openPage(ctx, { query = '', dev = false, fonts = false } = {}) {
    const { browser, origin, devOrigin, viewport, control } = ctx;
    const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
    try {
      const page = await context.newPage();
      page.errors = [];
      page.on('pageerror', (error) => page.errors.push(String(error.message).slice(0, 300)));
      await page.addInitScript(CLIPBOARD, { twice: control?.clipboard?.twice === true, guess: control?.clipboard?.guess === true, exposed: control?.clipboard?.exposed === true });
      await page.addInitScript(COUNTERS);
      await page.addInitScript(HELPERS);
      if (control?.init !== undefined) await page.addInitScript(control.init);
      const params = [query, control?.query].filter((part) => part !== undefined && part !== '').join('&');
      await page.goto(`${dev ? devOrigin : origin}/shell/probes/ports-fixture.html${params === '' ? '' : `?${params}`}`, { waitUntil: 'load' });
      await page.waitForSelector('[data-shell-part="window"]');
      if (fonts) await normalizeFont(page, { rootVar: '--ov-font-ui' });
      return page;
    } catch (error) {
      // A page that could not be set up is not handed to the caller, who has not yet entered the block that closes it: it is closed here, so that it is not left open under the sections that follow (the runner keeps the browser).
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  /**
   * The fake host is given what it lists and the names it knows, the panel is opened and the Ports tool is chosen, as a person does it. `tall` raises the panel to its largest with the keyboard of its splitter (End), so that every row is in view and the
   * table does not scroll: a section that acts on rows far down the table (a press, a menu, the keyboard) has no scroll in its way, which an open menu would put away.
   */
  async function reach(page, { sessions = SET, names = NAMES, rows = true, tall = false } = {}) {
    await page.evaluate(
      ({ given, known }) => {
        window.__ports.set(given);
        for (const [plugin, connection, name] of known) window.__ports.names.set(plugin, connection, name);
      },
      { given: sessions, known: names },
    );
    await page.click('[data-shell-part="panelToggle"]');
    await page.getByRole('tab', { name: 'Ports' }).click();
    await page.waitForSelector('[data-shell-part="portsBody"]');
    if (tall) {
      await page.locator('[data-shell-part="panelHandle"]').focus();
      await page.keyboard.press('End');
      await waitFor(page, () => window.__t.body() !== null && window.__t.body().getBoundingClientRect().height > 330, null, 4000);
    }

    if (rows) await waitFor(page, (count) => window.__t.ids().length === count, sessions.length);
    if (tall) {
      const scrolls = await waitFor(page, () => {
        const scroller = window.__t.body()?.firstElementChild;
        return scroller !== undefined && scroller !== null && scroller.scrollHeight <= scroller.clientHeight + 1;
      }, null, 4000);
      if (!scrolls) throw new Error('the table still scrolls with the panel at its largest');
    }
  }

  /**
   * The window's own facts: Stop is pressed for the worker (the host does not answer, so the row says Stopping) and the plugin of the queue stops (the host drops its forwards from the list and says so, so the row says Stopped and why). The
   * pointer is put away after, so that no tooltip is open.
   */
  async function stage(page) {
    await page.evaluate(() => {
      window.__ports.closes.mode = 'hold';
    });
    await page.locator('[data-ports-id="worker"]').getByRole('button', { name: 'Stop' }).click();
    await page.evaluate((rest) => {
      window.__ports.set(rest);
      window.__ports.emit('plugin/unloaded', { pluginID: 'other', cause: 'crashed' });
    }, SET.filter((entry) => entry.id !== 'queue'));
    const staged = await waitFor(page, () => window.__t.stateOf('worker') === 'stopping' && window.__t.stateOf('queue') === 'stopped', null, 6000);
    const found = await page.evaluate(() => ({ worker: window.__t.stateOf('worker'), queue: window.__t.stateOf('queue'), ids: window.__t.ids() }));
    await page.mouse.move(1, 1);
    await frames(page);
    // What was not staged, for the check that scans the table: the rows of the forwards, the worker stopping and the queue stopped.
    const unstaged = [];
    if (JSON.stringify([...found.ids].sort()) !== JSON.stringify(SET.map((entry) => entry.id).sort())) unstaged.push(`the rows are ${JSON.stringify(found.ids)}, not the ${String(SET.length)} forwards`);
    if (!staged || found.worker !== 'stopping') unstaged.push(`the worker is ${JSON.stringify(found.worker)}, not stopping`);
    if (!staged || found.queue !== 'stopped') unstaged.push(`the queue is ${JSON.stringify(found.queue)}, not stopped`);
    return unstaged;
  }

  const rowOf = (read, id) => read.rows.find((row) => row.id === id);
  /** How a row with a second line stands against the mock's two-line row (`second`): the second line's size, weight and colour, the height of the row and where the line starts in it. Answers the problems. */
  const secondLineProblems = (row, line, second) => {
    const problems = [];
    const wanted = second.resource.sub;
    if (`${line.style['font-size']}/${line.style['line-height']} ${line.style['font-weight']} ${line.style.color}` !== `${wanted.style['font-size']}/${wanted.style['line-height']} ${wanted.style['font-weight']} ${wanted.style.color}`) problems.push(`its second line is set in ${line.style['font-size']}/${line.style['line-height']} ${line.style.color}, the mock's is ${wanted.style['font-size']}/${wanted.style['line-height']} ${wanted.style.color}`);
    if (!near(row?.rect?.[3], second.rect[3])) problems.push(`its row is ${String(row?.rect?.[3])} px, the mock's two-line row is ${String(second.rect[3])}`);
    if (!near(line.rect[0] - (row?.cells[0].rect?.[0] ?? 0), wanted.rect[0] - second.cells[0].rect[0]) || !near(line.rect[1] - (row?.rect?.[1] ?? 0), wanted.rect[1] - second.rect[1])) problems.push(`its second line starts ${String(line.rect[0] - (row?.cells[0].rect?.[0] ?? 0))} px in and ${String(line.rect[1] - (row?.rect?.[1] ?? 0))} px down, the mock's ${String(wanted.rect[0] - second.cells[0].rect[0])} and ${String(wanted.rect[1] - second.rect[1])}`);
    return problems;
  };

  // ------------------------------------------------------------------------------------------------ geometry
  sections.geometry = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx, { fonts: true });
    try {
      await reach(page);
      await stage(page);
      await perturb(ctx, page, 'ready');
      const read = await page.evaluate(() => window.__t.read());
      const mock = reference()?.data?.[engine]?.[vp]?.table;
      if (mock === undefined) {
        for (const name of ['columns', 'header', 'rows', 'padding', 'mapping', 'actions', 'footer', 'layout']) check(`ports.${name}`, false, `${tag}: the mock's Ports tool is not measured (run mock-ports-measure.mjs)`);
        return;
      }

      const gaps = (buttons) => buttons.slice(1).map((button, index) => (button.rect === null || buttons[index].rect === null ? null : Math.round((button.rect[0] - (buttons[index].rect[0] + buttons[index].rect[2])) * 100) / 100));

      // ports.columns: five columns in the mock's order, in the header, in the position of the cells and in every row; the commands' column is named and not drawn; the table is named.
      {
        const problems = [];
        const heads = read.head.cells;
        if (JSON.stringify(heads.map((cell) => cell.text)) !== JSON.stringify(COLUMNS)) problems.push(`the headers read ${JSON.stringify(heads.map((cell) => cell.text))}, not ${JSON.stringify(COLUMNS)}`);
        if (JSON.stringify(mock.head.cells.map((cell) => cell.text)) !== JSON.stringify(COLUMNS)) problems.push(`the mock's headers are ${JSON.stringify(mock.head.cells.map((cell) => cell.text))}`);
        const xs = heads.map((cell) => cell.rect?.[0]);
        if (!xs.every((x, index) => typeof x === 'number' && (index === 0 || x > xs[index - 1]))) problems.push(`the headers stand at ${JSON.stringify(xs)}: not left to right`);
        for (const row of read.rows) {
          if (JSON.stringify(row.cells.map((cell) => cell.column)) !== JSON.stringify(KEYS)) problems.push(`row ${row.id} has the cells ${JSON.stringify(row.cells.map((cell) => cell.column))}`);
          else if (!row.cells.every((cell, index) => near(cell.rect?.[0], xs[index]))) problems.push(`row ${row.id} has its cells at ${JSON.stringify(row.cells.map((cell) => cell.rect?.[0]))}, the headers at ${JSON.stringify(xs)}`);
        }

        const hidden = heads[4]?.hidden;
        if (hidden === null || hidden === undefined || hidden[2] > 2 || hidden[3] > 2) problems.push(`the commands' header is ${JSON.stringify(hidden)}: it is named and not drawn (a box of 1 px)`);
        if (read.tableName !== 'Forwarded ports') problems.push(`the table is named ${JSON.stringify(read.tableName)}`);
        check('ports.columns', problems.length === 0, `${tag}: ${problems.slice(0, 4).join('; ')}`);
      }

      // ports.header: the mock's header row: 25 px, the muted 13 and 16 words, a line under it in the border's colour, the paint of the plane under the rows, sticky to the top of the scroller, the words where the mock puts them.
      {
        const problems = [];
        const expect = (name, got, want, same = (a, b) => a === b) => {
          if (!same(got, want)) problems.push(`${name} is ${JSON.stringify(got)}, the mock's is ${JSON.stringify(want)}`);
        };

        expect('the header row is', read.head.rect?.[3], mock.head.rect[3], near);
        read.head.cells.forEach((cell) => {
          const index = KEYS.indexOf(cell.column);
          const them = mock.head.cells[index];
          if (them === undefined) {
            problems.push(`the header ${cell.text} is a column the mock does not have`);
            return;
          }

          const name = `the header ${cell.text}`;
          expect(`${name} height`, cell.rect?.[3], them.rect[3], near);
          expect(`${name} font size`, cell.style?.['font-size'], them.style['font-size']);
          expect(`${name} line height`, cell.style?.['line-height'], them.style['line-height']);
          expect(`${name} weight`, cell.style?.['font-weight'], them.style['font-weight']);
          expect(`${name} colour`, cell.style?.color, them.style.color);
          expect(`${name} line under it`, `${cell.border?.['border-bottom-width']} ${cell.border?.['border-bottom-style']} ${cell.border?.['border-bottom-color']}`, `${them.border['border-bottom-width']} ${them.border['border-bottom-style']} ${them.border['border-bottom-color']}`);
          expect(`${name} plane`, cell.border?.['background-color'], them.border['background-color']);
          expect(`${name} position`, `${cell.border?.position} ${cell.border?.top}`, `${them.border.position} ${them.border.top}`);
          if (index < 4) expect(`${name} words start`, cell.content === null ? null : cell.content[0] - cell.rect[0], them.content === null ? null : them.content[0] - them.rect[0], near);
        });
        check('ports.header', problems.length === 0, `${tag}: ${said(problems)}`);
      }

      // ports.rows: a row of one line is the mock's 24 px, each cell with it, and the rows stand one on the other; the words of a cell are the mock's size, weight and colour in the UI face.
      {
        const problems = [];
        const expect = (name, got, want, same = (a, b) => a === b) => {
          if (!same(got, want)) problems.push(`${name} is ${JSON.stringify(got)}, the mock's is ${JSON.stringify(want)}`);
        };

        const wanted = mock.rows[0];
        const lines = LINES.map((id) => rowOf(read, id)).filter((row) => row !== undefined);
        if (lines.length !== LINES.length) problems.push(`${String(LINES.length - lines.length)} of the ${String(LINES.length)} rows are not in the table`);
        for (const row of lines) {
          expect(`row ${row.id} height`, row.rect?.[3], 24, near);
          for (const cell of row.cells) expect(`row ${row.id} cell ${cell.column} height`, cell.rect?.[3], 24, near);
        }

        // A row with a second line is the mock's two-line row: `cache` says that other computers may reach it (what the line says is ports.exposed's).
        expect('row cache (with a second line) height', rowOf(read, 'cache')?.rect?.[3], mock.rows[MOCK_ROWS.proxy]?.rect?.[3], near);
        read.rows.slice(1).forEach((row, index) => {
          const above = read.rows[index];
          expect(`row ${row.id} stands on the row above, at`, row.rect?.[1], (above.rect?.[1] ?? 0) + (above.rect?.[3] ?? 0), near);
        });
        const first = rowOf(read, 'api');
        if (first !== undefined) {
          expect('the name of a resource is', `${first.resource.nameStyle?.['font-size']}/${first.resource.nameStyle?.['line-height']} ${first.resource.nameStyle?.['font-weight']} ${first.resource.nameStyle?.color}`, `${wanted.resource.name['font-size']}/${wanted.resource.name['line-height']} ${wanted.resource.name['font-weight']} ${wanted.resource.name.color}`);
          expect('the face of a resource is', family(first.resource.nameStyle?.['font-family']), family(wanted.resource.name['font-family']));
          expect('the word of a state is', `${first.status?.style?.['font-size']}/${first.status?.style?.['line-height']} ${first.status?.style?.['font-weight']} ${first.status?.style?.color}`, `${wanted.state.labelStyle['font-size']}/${wanted.state.labelStyle['line-height']} ${wanted.state.labelStyle['font-weight']} ${wanted.state.labelStyle.color}`);
          expect('the face of a state is', family(first.status?.style?.['font-family']), family(wanted.state.labelStyle['font-family']));
          const named = rowOf(read, 'api')?.connection;
          expect('the size of a connection is', `${named?.style?.['font-size']}/${named?.style?.['line-height']} ${named?.style?.color}`, `${wanted.connection.style['font-size']}/${wanted.connection.style['line-height']} ${wanted.connection.style.color}`);
        }

        check('ports.rows', problems.length === 0, `${tag}: ${said(problems)}`);
      }

      // ports.padding: the paddings of a cell are the mock's (12 px at the outer edges, 10 px between the columns, 4 px above and below, none around the commands), and the words start where the mock's do.
      {
        const problems = [];
        const expect = (name, got, want) => {
          if (got !== want) problems.push(`${name} is ${JSON.stringify(got)}, the mock's is ${JSON.stringify(want)}`);
        };

        const row = rowOf(read, 'api');
        const wanted = mock.rows[0];
        if (row === undefined) problems.push('there is no row of the first forward');
        else {
          KEYS.forEach((key, index) => {
            const cell = row.cells.find((entry) => entry.column === key);
            const them = wanted.cells[index];
            for (const side of ['top', 'right', 'bottom', 'left']) expect(`the ${key} cell's padding ${side}`, cell?.box?.[`padding-${side}`], them.box[`padding-${side}`]);
            if (index < 3) expect(`where the words of the ${key} cell start`, cell?.content == null ? null : Math.round(cell.content[0] - cell.rect[0]), them.content === null ? null : Math.round(them.content[0] - them.rect[0]));
          });
          const cellOf = (key) => row.cells.find((entry) => entry.column === key);
          expect('where the state starts in its cell', Math.round((row.status?.rect?.[0] ?? 0) - (cellOf('status')?.rect?.[0] ?? 0)), Math.round(wanted.state.rect[0] - wanted.cells[3].rect[0]));
          expect('where the commands start in their cell', Math.round((row.group?.rect?.[0] ?? 0) - (cellOf('actions')?.rect?.[0] ?? 0)), Math.round(wanted.group.rect[0] - wanted.cells[4].rect[0]));
          read.head.cells.forEach((cell) => expect(`the header ${cell.text}'s padding left`, cell.box?.['padding-left'], mock.head.cells[KEYS.indexOf(cell.column)]?.box['padding-left']));
        }

        check('ports.padding', problems.length === 0, `${tag}: ${said(problems)}`);
      }

      // ports.mapping: `127.0.0.1:<local> → :<remote>/<protocol>` in the mock's code face at 13 and 16, as wide as the mock's words are (one advance for each character, so it is monospace), in the mock's colour.
      {
        const problems = [];
        const expect = (name, got, want, same = (a, b) => a === b) => {
          if (!same(got, want)) problems.push(`${name} is ${JSON.stringify(got)}, the mock's is ${JSON.stringify(want)}`);
        };

        for (const [id, index] of Object.entries(MOCK_ROWS)) {
          const row = rowOf(read, id);
          const them = mock.rows[index].mapping;
          expect(`the mapping of ${id} reads`, row?.mapping.text, them.text);
          expect(`the mapping of ${id} is as wide as`, row?.mapping.width, them.width, near);
          expect(`the face of the mapping of ${id} is`, family(row?.mapping.style?.['font-family']), family(them.style['font-family']));
          expect(`the size of the mapping of ${id} is`, `${row?.mapping.style?.['font-size']}/${row?.mapping.style?.['line-height']} ${row?.mapping.style?.['font-weight']} ${row?.mapping.style?.color}`, `${them.style['font-size']}/${them.style['line-height']} ${them.style['font-weight']} ${them.style.color}`);
        }

        const advances = read.rows.map((row) => (row.mapping.width === null ? null : row.mapping.width / [...row.mapping.text].length));
        if (!advances.every((advance) => near(advance, advances[0], 0.02))) problems.push(`the characters of a mapping are not all as wide as each other: ${JSON.stringify(advances.map((advance) => Math.round((advance ?? 0) * 100) / 100))}`);
        check('ports.mapping', problems.length === 0, `${tag}: ${said(problems)}`);
      }

      // ports.actions: the commands of a row are 24 px targets with a 16 px glyph, 8 px apart, 12 px from the end of the row, and in the middle of the row.
      {
        const problems = [];
        const expect = (name, got, want, same = (a, b) => a === b) => {
          if (!same(got, want)) problems.push(`${name} is ${JSON.stringify(got)}, the mock's is ${JSON.stringify(want)}`);
        };

        const wanted = mock.rows[0];
        const buttonGap = Math.round((wanted.buttons[1].rect[0] - (wanted.buttons[0].rect[0] + wanted.buttons[0].rect[2])) * 100) / 100;
        const inset = Math.round((wanted.rect[0] + wanted.rect[2] - (wanted.buttons.at(-1).rect[0] + wanted.buttons.at(-1).rect[2])) * 100) / 100;
        for (const id of ['api', 'gateway', 'worker', 'payments']) {
          const row = rowOf(read, id);
          if (row === undefined || row.buttons.length !== 3) {
            problems.push(`row ${id} has ${String(row?.buttons.length)} commands, not 3`);
            continue;
          }

          for (const button of row.buttons) {
            expect(`the ${button.label} button of ${id}`, `${String(button.rect?.[2])} x ${String(button.rect?.[3])}`, `${String(wanted.buttons[0].rect[2])} x ${String(wanted.buttons[0].rect[3])}`);
            expect(`the glyph in the ${button.label} button of ${id}`, `${String(button.svg?.[2])} x ${String(button.svg?.[3])} at ${String(Math.round((button.svg?.[0] ?? 0) - (button.rect?.[0] ?? 0)))}, ${String(Math.round((button.svg?.[1] ?? 0) - (button.rect?.[1] ?? 0)))}`, `16 x 16 at 4, 4`);
            expect(`the ${button.label} button of ${id} stands in the middle of its row, at`, (button.rect?.[1] ?? 0) + (button.rect?.[3] ?? 0) / 2, (row.rect?.[1] ?? 0) + (row.rect?.[3] ?? 0) / 2, near);
          }

          for (const gap of gaps(row.buttons)) expect(`the space between two buttons of ${id}`, gap, buttonGap, near);
          const last = row.buttons.at(-1).rect;
          expect(`the room after the last button of ${id}`, Math.round(((row.rect?.[0] ?? 0) + (row.rect?.[2] ?? 0) - ((last?.[0] ?? 0) + (last?.[2] ?? 0))) * 100) / 100, inset, near);
        }

        check('ports.actions', problems.length === 0, `${tag}: ${said(problems)}`);
      }

      // ports.footer: the count of the forwards, as the mock's footer says it (`<n> forwards`, the 12 and 16 muted words, a 33 px lane with a line over it, 12 px in), at the foot of the panel.
      {
        const problems = [];
        const expect = (name, got, want, same = (a, b) => a === b) => {
          if (!same(got, want)) problems.push(`${name} is ${JSON.stringify(got)}, the mock's is ${JSON.stringify(want)}`);
        };

        const footer = read.footer;
        if (footer === null || footer.count === null) problems.push('the table has no footer that counts');
        else {
          const rows = read.rows.length;
          expect('the footer counts', /^(\d+) forwards?/.exec(footer.count.text)?.[1] ?? null, String(rows));
          expect('the footer is', footer.rect?.[3], mock.footer.rect[3], near);
          expect('the foot of the footer is the foot of the panel, at', (footer.rect?.[1] ?? 0) + (footer.rect?.[3] ?? 0), (read.panel?.[1] ?? 0) + (read.panel?.[3] ?? 0), near);
          expect('the footer is as wide as the panel', footer.rect?.[2], read.panel?.[2], near);
          expect('the count is set in', `${footer.count.style?.['font-size']}/${footer.count.style?.['line-height']} ${footer.count.style?.['font-weight']} ${footer.count.style?.color}`, `${mock.footer.count.style['font-size']}/${mock.footer.count.style['line-height']} ${mock.footer.count.style['font-weight']} ${mock.footer.count.style.color}`);
          expect('the count starts', footer.count.content === null ? null : Math.round(footer.count.content[0] - (footer.rect?.[0] ?? 0)), Math.round(mock.footer.count.rect[0] - mock.footer.rect[0]));
          expect('the footer has a line over it', `${footer.box?.['border-top-width']} ${footer.box?.['border-top-color']}`, `${mock.footer.box['border-top-width']} ${mock.footer.box['border-top-color']}`);
          expect('the footer is padded', `${footer.box?.['padding-top']} ${footer.box?.['padding-right']} ${footer.box?.['padding-bottom']} ${footer.box?.['padding-left']}`, `${mock.footer.box['padding-top']} ${mock.footer.box['padding-right']} ${mock.footer.box['padding-bottom']} ${mock.footer.box['padding-left']}`);
        }

        check('ports.footer', problems.length === 0, `${tag}: ${said(problems)}`);
      }

      // ports.layout: the columns stand where the mock's do. Resource takes the rest and Mapping, Connection, Status and Actions are fitted to their content (no share of the table), so each of them stands at the mock's distance from the right edge of
      // the table, less the two things the mock has and the tool has not: the commands (the mock has Restart and Inspect, the tool has Open in browser beside Stop and Copy address: one command and its gap fewer) and the floor of a text column's
      // header (the mock's Connection column is never narrower than its header and a floor, 14 px more than the tool's). Read with no connection named, so that the column says a dash in the mock and in the tool: a name is another thing (the note says
      // how: the mock stretches a column with a name, a text column that shares the free room with Resource, and the tool fits it to the name).
      {
        const problems = [];
        const bareMock = reference()?.data?.[engine]?.[vp]?.bare;
        const bare = await openPage(ctx, { fonts: true });
        try {
          await reach(bare, { names: [] });
          await stage(bare);
          await perturb(ctx, bare, 'bare');
          const bareRead = await bare.evaluate(() => window.__t.read());
          if (bareMock === undefined) problems.push("the mock's columns are not measured (run mock-ports-measure.mjs)");
          else {
            const theirs = Object.fromEntries(bareMock.columns.map((column) => [column.column, column]));
            const ours = Object.fromEntries(bareRead.columns.map((column) => [column.column, column]));
            const step = mock.rows[0].buttons[1].rect[0] - mock.rows[0].buttons[0].rect[0];
            const commands = (mock.rows[0].buttons.length - (rowOf(bareRead, 'api')?.buttons.length ?? 0)) * step;
            const floor = Math.round((theirs.connection.width - 20 - (bareMock.head[2].content?.[2] ?? 0)) * 100) / 100;
            const expected = { actions: theirs.actions.fromRight - commands, status: theirs.status.fromRight - commands, connection: theirs.connection.fromRight - commands - floor, mapping: theirs.mapping.fromRight - commands - floor };
            for (const [column, want] of Object.entries(expected)) {
              const got = ours[column]?.fromRight;
              if (!near(got, want, 1.5)) problems.push(`the ${column} column stands ${String(got)} px from the right edge of the table; the mock's stands ${String(theirs[column].fromRight)}, and ${String(Math.round(want * 100) / 100)} less the ${String(commands)} px of commands and the ${String(floor)} px of header floor it has and the tool has not`);
            }

            if (!near(ours.resource?.x, bareRead.table?.[0], 1)) problems.push(`the resource column starts at ${String(ours.resource?.x)}, not at the left edge of the table (${String(bareRead.table?.[0])})`);
            if ((ours.resource?.width ?? 0) < 160) problems.push(`the resource column is ${String(ours.resource?.width)} px wide, under its floor of 160`);
            note(`layout ${tag}: no connection named: Mapping starts at ${String(Math.round(((ours.mapping?.x ?? 0) + 10) * 100) / 100)} (the mock's ${String(theirs.mapping.x + 10)}, ${String(commands)} px of commands and ${String(floor)} of floor more), Status at ${String(ours.status?.x)} (${String(theirs.status.x)}), Actions at ${String(ours.actions?.x)} (${String(theirs.actions.x)})`);
          }
        } finally {
          await bare.context().close();
        }

        check('ports.layout', problems.length === 0, `${tag}: ${said(problems)}`);
      }

      let named43;
      // ports.layoutnames: the columns stand where the mock's do when the connections have NAMES. Then Connection is a text column, which the mock stretches: Resource and Connection share the room the fixed columns leave, in proportion to what each needs
      // (`fitSolve`), so Mapping starts at 768 at 1440 px and 644 at 1280 in the mock, with a Connection column of 220 and 184 px. The tool's share is the mock's proportion of what the mock gives, plus the 32 px that its two commands fewer leave (shared
      // in that proportion), within NAMED_TOLERANCE (the tool has no tile before a name and its widest name is narrower than the mock's cut: the data is NAMED_FIVE). A Connection column fitted to its names or one that takes all the room is far outside it.
      {
        const problems = [];
        const named = await openPage(ctx, { fonts: true });
        try {
          await reach(named, { sessions: NAMED_FIVE });
          await named.evaluate(() => {
            window.__ports.closes.mode = 'hold';
          });
          await buttonOf(named, 'worker', 'Stop').click();
          await waitFor(named, () => window.__t.stateOf('worker') === 'stopping');
          await named.mouse.move(1, 1);
          await frames(named);
          const referenceRead = await named.evaluate(() => window.__t.read());
          named43 = Object.fromEntries(referenceRead.columns.map((column) => [column.column, column]));
          await perturb(ctx, named, 'named');
          const namedRead = await named.evaluate(() => window.__t.read());
          const theirs = Object.fromEntries((mock.columns ?? []).map((column) => [column.column, column]));
          const ours = Object.fromEntries(namedRead.columns.map((column) => [column.column, column]));
          if (mock.columns === undefined) problems.push("the mock's columns are not measured (run mock-ports-measure.mjs)");
          else {
            const step = mock.rows[0].buttons[1].rect[0] - mock.rows[0].buttons[0].rect[0];
            const commands = (mock.rows[0].buttons.length - (rowOf(namedRead, 'api')?.buttons.length ?? 0)) * step;
            const share = theirs.connection.width / (theirs.resource.width + theirs.connection.width);
            const round2 = (value) => Math.round(value * 100) / 100;
            const expectNear = (name, got, want, tolerance) => {
              if (!near(got, want, tolerance)) problems.push(`${name} is ${String(got)}, expected ${String(round2(want))} (the mock's, within ${String(tolerance)} px)`);
            };

            expectNear('the Actions column, from the right edge of the table,', ours.actions?.fromRight, theirs.actions.fromRight - commands, 1.5);
            expectNear('the Status column, from the right edge of the table,', ours.status?.fromRight, theirs.status.fromRight - commands, 1.5);
            expectNear('the Mapping column is wide, and', ours.mapping?.width, theirs.mapping.width, 1.5);
            expectNear('the Connection column is wide, and', ours.connection?.width, theirs.connection.width + share * commands, NAMED_TOLERANCE);
            expectNear('Mapping starts at', ours.mapping?.x, theirs.mapping.x + (1 - share) * commands, NAMED_TOLERANCE);
            if (!near(ours.resource?.x, namedRead.table?.[0], 1)) problems.push(`the resource column starts at ${String(ours.resource?.x)}, not at the left edge of the table (${String(namedRead.table?.[0])})`);
            note(`layout with names ${tag}: Connection ${String(ours.connection?.width)} px (the mock's ${String(theirs.connection.width)}, ${String(round2((ours.connection?.width ?? 0) - theirs.connection.width - share * commands))} more than its proportion of the ${String(commands)} px), Mapping starts at ${String(round2((ours.mapping?.x ?? 0) + 10))} (the mock's ${String(round2(theirs.mapping.x + 10))}), Resource ${String(ours.resource?.width)} px (the mock's ${String(theirs.resource.width)})`);
            report.numbers[`layout with names ${tag}`] = { ours: namedRead.columns, theirs: mock.columns };
          }
        } finally {
          await named.context().close();
        }

        check('ports.layoutnames', problems.length === 0, `${tag}: ${said(problems)}`);
      }

      // ports.layoutlong: a name wider than the cap does not take the weight. The mock weighs a name by its cut (44 characters); the tool caps the weight of a Resource cell (240 px and its insets), so a 236-character name weighs the cap and not its
      // width, and Connection keeps its share: the same columns as with the 43-character names (within 6 px: the cap weighs a few px less than the widest of those) and the mock's proportion within NAMED_TOLERANCE, and not the floor of 92 px that
      // a name that weighs its width leaves it.
      {
        const problems = [];
        const long = await openPage(ctx, { fonts: true });
        try {
          await reach(long, { sessions: LONG_FIVE });
          await long.evaluate(() => {
            window.__ports.closes.mode = 'hold';
          });
          await buttonOf(long, 'worker', 'Stop').click();
          await waitFor(long, () => window.__t.stateOf('worker') === 'stopping');
          await long.mouse.move(1, 1);
          await frames(long);
          await perturb(ctx, long, 'long');
          const longRead = await long.evaluate(() => window.__t.read());
          const theirs = Object.fromEntries((mock.columns ?? []).map((column) => [column.column, column]));
          const ours = Object.fromEntries(longRead.columns.map((column) => [column.column, column]));
          if (mock.columns === undefined || named43 === undefined) problems.push("the mock's columns are not measured (run mock-ports-measure.mjs), or the page with names was not read");
          else {
            const step = mock.rows[0].buttons[1].rect[0] - mock.rows[0].buttons[0].rect[0];
            const commands = (mock.rows[0].buttons.length - (rowOf(longRead, 'api')?.buttons.length ?? 0)) * step;
            const share = theirs.connection.width / (theirs.resource.width + theirs.connection.width);
            const round2 = (value) => Math.round(value * 100) / 100;
            const expectNear = (name, got, want, tolerance, of) => {
              if (!near(got, want, tolerance)) problems.push(`${name} is ${String(got)}, expected ${String(round2(want))} (${of}, within ${String(tolerance)} px)`);
            };

            expectNear('the Connection column is wide, and', ours.connection?.width, theirs.connection.width + share * commands, NAMED_TOLERANCE, "the mock's proportion");
            expectNear('Mapping starts at', ours.mapping?.x, theirs.mapping.x + (1 - share) * commands, NAMED_TOLERANCE, "the mock's proportion");
            expectNear('the Connection column is wide, and', ours.connection?.width, named43.connection.width, 6, 'the same as with names of 43 characters');
            expectNear('Mapping starts at', ours.mapping?.x, named43.mapping.x, 6, 'the same as with names of 43 characters');
            note(`layout with a long name ${tag}: Connection ${String(ours.connection?.width)} px (with names of 43 characters ${String(named43.connection.width)}, the mock's ${String(theirs.connection.width)}), Mapping starts at ${String(round2((ours.mapping?.x ?? 0) + 10))} (${String(round2(named43.mapping.x + 10))}; the mock's ${String(round2(theirs.mapping.x + 10))}), Resource ${String(ours.resource?.width)} px`);
          }
        } finally {
          await long.context().close();
        }

        check('ports.layoutlong', problems.length === 0, `${tag}: ${said(problems)}`);
      }

      note(`geometry ${tag}: rows ${JSON.stringify([...new Set(read.rows.map((row) => row.rect?.[3]))])} px (the mock's: ${JSON.stringify([...new Set(mock.rows.map((row) => row.rect[3]))])}), header ${String(read.head.rect?.[3])} px, footer ${String(read.footer?.rect?.[3])} px, buttons ${JSON.stringify(gaps(read.rows[0].buttons))} apart`);
      report.numbers[`geometry ${tag}`] = { rows: read.rows.map((row) => [row.id, row.rect]), head: read.head.rect, footer: read.footer?.rect };
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ states
  sections.states = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await page.evaluate(() => {
        window.__t.watch();
      });
      await reach(page);
      await stage(page);
      await perturb(ctx, page, 'ready');
      const mock = reference()?.data?.[engine]?.[vp]?.table;
      const read = await page.evaluate(() => window.__t.read());
      const expectState = {
        api: { word: 'Running', state: 'running', role: 'running', glyph: 'play' },
        dns: { word: 'Running', state: 'running', role: 'running', glyph: 'play' },
        jobs: { word: 'Paused', state: 'paused', role: 'stopped', glyph: 'circle-minus' },
        gateway: { word: 'Stopped', state: 'stopped', role: 'stopped', glyph: 'circle-minus' },
        proxy: { word: 'Failed', state: 'failed', role: 'error', glyph: 'status-error' },
        worker: { word: 'Stopping', state: 'stopping', role: 'progress', glyph: 'loader-circle' },
        queue: { word: 'Stopped', state: 'stopped', role: 'stopped', glyph: 'circle-minus' },
        payments: { word: 'Running', state: 'running', role: 'running', glyph: 'play' },
        db: { word: 'Running', state: 'running', role: 'running', glyph: 'play' },
        cache: { word: 'Running', state: 'running', role: 'running', glyph: 'play' },
      };

      // ports.words: the host's words for what a forward is (Running, Paused, Stopped, Failed), the window's own Stopping, and Stopped for a forward whose plugin stopped; nothing else is said.
      {
        const problems = [];
        for (const [id, want] of Object.entries(expectState)) {
          const row = rowOf(read, id);
          if (row?.status?.word !== want.word) problems.push(`${id} says ${JSON.stringify(row?.status?.word)}, not ${want.word}`);
          if (row?.state !== want.state) problems.push(`${id} is in the state ${JSON.stringify(row?.state)}, not ${want.state}`);
        }

        const allowed = new Set(['Running', 'Paused', 'Stopped', 'Failed', 'Stopping']);
        const others = read.rows.filter((row) => !allowed.has(row.status?.word ?? '')).map((row) => `${row.id}: ${JSON.stringify(row.status?.word)}`);
        if (others.length > 0) problems.push(`words that are not the host's: ${others.join(', ')}`);
        check('ports.words', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // ports.icons: the glyph of each state is the mock's (its role's glyph: play, minus circle, error, progress), the word's role is the mock's, both are 16 px and the word starts where the mock's does, and the paint is the mock's.
      {
        const problems = [];
        const mine = new Map(Object.entries(MOCK_ROWS));
        for (const [id, want] of Object.entries(expectState)) {
          const row = rowOf(read, id);
          if (row?.status?.glyph !== want.glyph) problems.push(`${id} draws the glyph ${JSON.stringify(row?.status?.glyph)}, not ${want.glyph}`);
          if (row?.status?.role !== want.role) problems.push(`${id} has the role ${JSON.stringify(row?.status?.role)}, not ${want.role}`);
          const index = mine.get(id);
          if (mock !== undefined && index !== undefined) {
            const them = mock.rows[index].state;
            if (GLYPH_OF[them.icon] !== row?.status?.glyph) problems.push(`${id} draws ${JSON.stringify(row?.status?.glyph)} and the mock's role ${them.role} draws ${them.icon} (${String(GLYPH_OF[them.icon])})`);
            if (them.role !== row?.status?.role) problems.push(`${id} has the role ${JSON.stringify(row?.status?.role)} and the mock's has ${them.role}`);
            const paint = [...new Set(them.paint.flatMap((shape) => [shape.fill, shape.stroke]).filter((value) => value !== 'none' && value !== ''))].sort();
            if (JSON.stringify(paint) !== JSON.stringify(row?.status?.paint)) problems.push(`${id} paints its glyph ${JSON.stringify(row?.status?.paint)}, the mock paints ${JSON.stringify(paint)}`);
            if (!near(row?.status?.icon?.[2], them.glyph[2]) || !near(row?.status?.icon?.[3], them.glyph[3])) problems.push(`${id} draws its glyph ${JSON.stringify(row?.status?.icon?.slice(2))}, the mock's is ${JSON.stringify(them.glyph.slice(2))}`);
            const gap = row?.status?.label === null || row?.status?.label === undefined ? null : row.status.label[0] - (row.status.icon?.[0] ?? 0);
            if (!near(gap, them.label[0] - them.glyph[0])) problems.push(`${id} starts its word ${String(gap)} px after its glyph, the mock's is ${String(them.label[0] - them.glyph[0])}`);
          }
        }

        if (mock === undefined) problems.push('the mock is not measured (run mock-ports-measure.mjs)');
        check('ports.icons', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // ports.reason: a forward whose plugin stopped says it on a second line of its Resource cell, in the mock's second-line size and colour and with the mock's two-line row; a Stop the host would not do says why, with the host's words, and the row goes back to what it was;
      // a forward with nothing to say has no second line.
      {
        const problems = [];
        const row = rowOf(read, 'queue');
        const line = row?.resource.reason;
        if (line?.text !== REASON_PLUGIN) problems.push(`the forward whose plugin stopped says ${JSON.stringify(line?.text)}, not ${JSON.stringify(REASON_PLUGIN)}`);
        const second = mock?.rows[MOCK_ROWS.proxy];
        if (second !== undefined && second.resource.sub !== null && line !== null && line !== undefined) problems.push(...secondLineProblems(row, line, second));
        else if (mock === undefined) problems.push('the mock is not measured (run mock-ports-measure.mjs)');
        // `cache` listens on every network interface and runs: its second line says that other computers may reach it (ports.exposed holds the words for every way of stating a host).
        const everywhere = rowOf(read, 'cache')?.resource.reason;
        if (everywhere?.text !== EVERYWHERE) problems.push(`the forward that listens on every interface says ${JSON.stringify(everywhere?.text)}, not ${JSON.stringify(EVERYWHERE)}`);
        const others = read.rows.filter((entry) => entry.id !== 'queue' && entry.id !== 'cache' && entry.resource.reason !== null).map((entry) => entry.id);
        if (others.length > 0) problems.push(`rows with nothing to say have a second line: ${others.join(', ')}`);
        // The host would not close it.
        await page.evaluate(() => {
          window.__ports.closes.mode = 'refuse';
        });
        await page.locator('[data-ports-id="cache"]').getByRole('button', { name: 'Stop' }).click();
        await waitFor(page, () => window.__t.row('cache')?.querySelector('[data-ports-part="reason"]') !== null);
        const refused = await page.evaluate(() => ({ reason: window.__t.row('cache')?.querySelector('[data-ports-part="reason"]')?.textContent ?? null, word: window.__t.readRow(window.__t.row('cache')).status?.word ?? null, live: window.__t.told.slice(), height: window.__t.row('cache')?.getBoundingClientRect().height ?? null }));
        if (refused.reason !== "Couldn't stop it. The plugin is busy with another forward.") problems.push(`a Stop the host refused says ${JSON.stringify(refused.reason)}`);
        if (refused.word !== 'Running') problems.push(`and the row says ${JSON.stringify(refused.word)}, not Running`);
        if (!refused.live.includes(`Couldn't stop ${mappingOf(byId('cache'))}`)) problems.push(`and the live region was told ${JSON.stringify(refused.live)}`);
        if (!near(refused.height, 40)) problems.push(`and the row is ${String(refused.height)} px`);
        check('ports.reason', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // ports.names: the connection is said by its NAME and never by its id; a connection with no name is a dash that says it is not reported; a static target has its address for a resource and a dash that says there is no connection; a name that arrives is drawn
      // without the host being asked again.
      {
        const problems = [];
        const named = ['api', 'dns', 'jobs', 'gateway', 'proxy', 'worker', 'payments'];
        for (const id of named) if (rowOf(read, id)?.connection.text !== 'Staging') problems.push(`the connection of ${id} reads ${JSON.stringify(rowOf(read, id)?.connection.text)}, not its name Staging`);
        if (rowOf(read, 'queue')?.connection.text !== 'Production') problems.push(`the connection of queue reads ${JSON.stringify(rowOf(read, 'queue')?.connection.text)}, not its name Production`);
        const unnamed = rowOf(read, 'cache');
        if (unnamed?.connection.text !== '—' || !/^Not reported/.test(unnamed?.connection.dash ?? '')) problems.push(`a connection with no name is ${JSON.stringify(unnamed?.connection.text)} named ${JSON.stringify(unnamed?.connection.dash)}, not a dash that says Not reported`);
        const target = rowOf(read, 'db');
        if (target?.resource.text !== 'db.internal:5432') problems.push(`a static target reads ${JSON.stringify(target?.resource.text)}, not its address`);
        if (target?.connection.text !== '—' || !/^Not applicable/.test(target?.connection.dash ?? '')) problems.push(`its connection is ${JSON.stringify(target?.connection.text)} named ${JSON.stringify(target?.connection.dash)}, not a dash that says Not applicable`);
        const drawn = await page.evaluate((ids) => {
          const body = window.__t.body();
          const everything = [body.textContent ?? '', ...[...body.querySelectorAll('*')].flatMap((element) => [...element.attributes].map((attribute) => attribute.value))].join('\n');
          return ids.filter((id) => everything.includes(id));
        }, CONNECTION_IDS);
        if (drawn.length > 0) problems.push(`the table draws the ids ${drawn.join(', ')}, in its text or its attributes`);
        const listed = await page.evaluate(() => window.__ports.reads.listed());
        await page.evaluate(() => {
          window.__ports.names.set('acme', 'conn-x', 'Edge');
        });
        const learned = await waitFor(page, () => window.__t.readRow(window.__t.row('cache')).connection.text === 'Edge', null, 4000);
        const after = await page.evaluate(() => window.__ports.reads.listed());
        if (!learned) problems.push('a name that arrived is not drawn');
        if (after !== listed) problems.push(`a name that arrived asked the host for the list again (${String(listed)} reads, then ${String(after)})`);
        check('ports.names', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // ports.long: a name that is longer than its column is one line of 24 px, cut in the middle so that both its beginning and its end are in view (the kit's split, with the ellipsis between the two), a name that fits is not cut, and the table grows
      // no scroll bar for it.
      {
        const problems = [];
        await waitFor(page, () => window.__t.row('payments')?.querySelector('[data-column="resource"] [data-ov-shape]')?.getAttribute('data-ov-shape') === 'split', null, 2000);
        const shapes = await page.evaluate(
          (ids) =>
            Object.fromEntries([
              ...ids.map((id) => {
                const own = window.__t.row(id)?.querySelector('[data-column="resource"]') ?? null;
                const name = own?.querySelector('[data-ov-shape]') ?? null;
                if (own === null || name === null) return [id, null];
                const pieces = [...name.children].filter((piece) => piece.hasAttribute('data-ov-text')).map((piece) => piece.getAttribute('data-ov-text'));
                return [id, { shape: name.getAttribute('data-ov-shape'), pieces, inside: Math.round(name.getBoundingClientRect().right) <= Math.round(own.getBoundingClientRect().right) }];
              }),
              // The geometry is read in the same evaluation as the shape, after the split: a snapshot from before it would not see an overflow that the split brings.
              [
                'geometry',
                (() => {
                  const row = window.__t.row('payments');
                  const scroller = window.__t.table()?.parentElement ?? null;
                  return { rowHeight: row?.getBoundingClientRect().height ?? null, cellWidth: row?.querySelector('[data-column="resource"]')?.getBoundingClientRect().width ?? null, scroll: scroller === null ? null : { client: scroller.clientWidth, scroll: scroller.scrollWidth } };
                })(),
              ],
            ]),
          ['payments', 'api'],
        );
        const long = shapes.payments;
        const geometry = shapes.geometry;
        if (!near(geometry.rowHeight, 24)) problems.push(`its row is ${String(geometry.rowHeight)} px`);
        if (long === null) problems.push('the row has no resource cell');
        else {
          if (long.shape !== 'split') problems.push(`the name is drawn in the shape ${JSON.stringify(long.shape)}, not cut in the middle (split): it is longer than its column`);
          if (!(long.pieces[0] ?? '').startsWith('payments-service') || !(long.pieces[1] ?? '').endsWith('must-be-cut')) problems.push(`the name is cut into ${JSON.stringify(long.pieces)}: both its beginning and its end are to be in view`);
          if (!long.inside) problems.push('the name runs out of its cell');
        }

        if (shapes.api?.shape !== 'plain') problems.push(`a name that fits is drawn in the shape ${JSON.stringify(shapes.api?.shape)}, not as it is (plain)`);
        if (geometry.scroll !== null && geometry.scroll.scroll > geometry.scroll.client + 1) problems.push(`the table scrolls across: ${JSON.stringify(geometry.scroll)}`);
        if (geometry.cellWidth !== null && geometry.cellWidth < 160) problems.push(`the resource cell is ${String(geometry.cellWidth)} px wide, under its floor of 160`);
        check('ports.long', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      note(`states ${tag}: ${JSON.stringify(Object.fromEntries(read.rows.map((row) => [row.id, `${row.status?.word}/${row.status?.glyph}`])))}`);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ helpers of the sections that act
  const tabKey = (engine) => (engine === 'webkit' ? 'Alt+Tab' : 'Tab');
  /** A command of a row, by what it does (`data-ports-action`) and not by its name: the name is held by `ports.buttons` alone, and the platform's own lookup by it is `byName`. */
  const ACTIONS = { Stop: 'stop', 'Open in browser': 'open', 'Copy address': 'copy', 'Copy port': 'copy' };
  const buttonOf = (page, id, name) => page.locator(`[data-ports-id="${id}"] button[data-ports-action="${ACTIONS[name]}"]`);
  const byName = (page, id, name) => page.locator(`[data-ports-id="${id}"]`).getByRole('button', { name, exact: true });
  /** A press that is made, or a problem that says it was not: a check that no call was made, which discarded a press that never reached the control, would pass on a log that nothing could have changed. */
  const press = async (problems, locator, what) => {
    try {
      await locator.click({ force: true, timeout: 3000 });
    } catch (error) {
      problems.push(`${what} could not be pressed: ${String(error?.message ?? error).split('\n')[0]}`);
    }
  };
  const activeNow = async (page) => page.evaluate(() => window.__t.active());
  const resourceOf = (entry) => (entry.connection_type === 'STATIC' ? entry.connection.address : entry.connection.resource_id);
  /** What a row is called for a person who cannot see the table: its resource and its mapping (`PortsRow.subjectOf`). */
  const subjectOf = (id) => {
    const entry = SET.find((candidate) => candidate.id === id);
    return `${resourceOf(entry)}, ${mappingOf(entry)}`;
  };

  const menuNow = async (page) => page.evaluate(() => window.__t.menu());
  /**
   * The table's scroller has stopped moving: its position is the same in three frames in a row. A scroll that is still on its way when a menu opens puts the menu away (the window's menu host closes on a scroll, as a menu should), and the table scrolls
   * smoothly to a row that was out of view, so a probe that opens a menu on such a row waits for the scroll to end first.
   */
  const stillTable = async (page) =>
    page.evaluate(async () => {
      const scroller = window.__t.body()?.firstElementChild ?? null;
      const steady = (async () => {
        let same = 0;
        let last = -1;
        while (same < 3) {
          await new Promise((resolve) => {
            window.__raf0(resolve);
          });
          const now = scroller?.scrollTop ?? 0;
          same = now === last ? same + 1 : 0;
          last = now;
        }

        return last;
      })();
      // A page that draws no frame is not waited for past two seconds.
      return Promise.race([
        steady,
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(scroller?.scrollTop ?? 0);
          }, 2000);
        }),
      ]);
    });
  /** The row menu is open (or gone), within `timeout` ms: answers what it holds. */
  const menuShown = async (page, shown = true, timeout = 8000) => {
    await waitFor(page, (want) => (window.__t.menu() !== null) === want, shown, timeout);
    return menuNow(page);
  };

  /** What the page was asked of the fake host and the clipboard: the addresses opened, the texts copied, the forwards closed. */
  const callsOf = async (page) => page.evaluate(() => ({ opened: window.__ports.opened.slice(), copied: window.__clip.writes.slice(), closed: [...window.__ports.closes.ids()] }));

  // ------------------------------------------------------------------------------------------------ actions
  sections.actions = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await page.evaluate(() => {
        window.__t.watch();
      });
      await reach(page, { tall: true });
      await stage(page);
      await perturb(ctx, page, 'ready');
      const read = await page.evaluate(() => window.__t.read());
      const mock = reference()?.data?.[engine]?.[vp];
      const glyphs = { LuCopy: 'copy', LuCheck: 'check' };

      // ports.buttons: Stop, Open in browser and Copy address are real buttons, in a group named for the forward, drawn without a pointer on the row, each with the name and the tip of its words (and a reason after them for one that cannot be used).
      {
        const problems = [];
        const row = rowOf(read, 'api');
        if (row?.group?.label !== `Port actions for ${subjectOf('api')}`) problems.push(`the group of the first forward is named ${JSON.stringify(row?.group?.label)}`);
        if (JSON.stringify(row?.buttons.map((button) => button.label)) !== JSON.stringify(['Stop', 'Open in browser', 'Copy address'])) problems.push(`its commands are ${JSON.stringify(row?.buttons.map((button) => button.label))}`);
        for (const button of row?.buttons ?? []) {
          if (button.type !== 'button') problems.push(`${String(button.label)} is a button of the type ${JSON.stringify(button.type)}`);
          if (button.rect === null) problems.push(`${String(button.label)} is not drawn while nobody points at the row`);
        }

        for (const name of ['Stop', 'Open in browser', 'Copy address']) {
          const found = await byName(page, 'api', name).count();
          if (found !== 1) problems.push(`the platform finds ${String(found)} buttons named ${name} in the row (one is right)`);
        }

        const tips = [
          ['api', 'Stop', 'Stop'],
          ['api', 'Copy address', 'Copy address'],
          ['proxy', 'Open in browser', `Open in browser ${NOT_RUNNING}`],
          ['queue', 'Stop', `Stop ${REASON_PLUGIN}`],
        ];
        const ACTION = { Stop: 'stop', 'Open in browser': 'open', 'Copy address': 'copy' };
        for (const [id, name, want] of tips) {
          await page.locator(`[data-ports-id="${id}"] button[data-ports-action="${ACTION[name]}"]`).hover();
          const shown = await waitFor(page, () => window.__t.tip() !== null, null, 6000);
          const got = shown ? await page.evaluate(() => window.__t.tip()) : null;
          if (got !== want) problems.push(`the tip of ${name} of ${id} says ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
          await page.mouse.move(1, 1);
          await waitFor(page, () => window.__t.tip() === null, null, 6000);
        }

        check('ports.buttons', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // ports.glyphs: the glyph of each command is the one the design draws where the registry has it (a square for Stop, an arrow out of a box for Open in browser, the mock's copy), and the nearest the registry has where it does not; the tool's tab has its own.
      {
        const problems = [];
        const wanted = await page.evaluate(() => ({
          stop: window.__ports.hasGlyph('square') ? 'square' : 'close',
          open: window.__ports.hasGlyph('external-link') ? 'external-link' : 'globe',
          tab: window.__ports.hasGlyph('cable') ? 'cable' : 'network',
          registry: ['square', 'external-link', 'cable'].filter((name) => window.__ports.hasGlyph(name)),
        }));
        const row = rowOf(read, 'api');
        const drawn = Object.fromEntries((row?.buttons ?? []).map((button) => [button.action, button.glyph]));
        if (drawn.stop !== wanted.stop) problems.push(`Stop draws ${JSON.stringify(drawn.stop)}, not ${wanted.stop}`);
        if (drawn.open !== wanted.open) problems.push(`Open in browser draws ${JSON.stringify(drawn.open)}, not ${wanted.open}`);
        if (drawn.copy !== 'copy') problems.push(`Copy address draws ${JSON.stringify(drawn.copy)}, not copy`);
        const mockCopy = mock?.copy;
        if (mockCopy === undefined) problems.push('the mock is not measured (run mock-ports-measure.mjs)');
        else if (glyphs[mockCopy.before[0]] !== drawn.copy) problems.push(`Copy address draws ${JSON.stringify(drawn.copy)} and the mock draws ${String(mockCopy.before[0])}`);
        const tab = await page.evaluate(() => document.querySelector('[role="tab"][id$="panel-tool-ports"] svg')?.getAttribute('data-ov-glyph') ?? null);
        if (tab !== wanted.tab) problems.push(`the tab of the tool draws ${JSON.stringify(tab)}, not ${wanted.tab}`);
        const tabName = await page.evaluate(() => document.querySelector('[role="tab"][id$="panel-tool-ports"]')?.textContent?.trim() ?? null);
        if (tabName !== 'Ports') problems.push(`the tab of the tool is named ${JSON.stringify(tabName)}, not Ports`);
        check('ports.glyphs', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
        note(`glyphs ${tag}: Stop ${String(drawn.stop)} (the mock draws ${String(mock?.table.rows[0].buttons[0].glyph[0])}), Open in browser ${String(drawn.open)}, Copy address ${String(drawn.copy)}, the tab ${String(tab)}; the registry has ${JSON.stringify(wanted.registry)} of square, external-link and cable`);
      }

      // ports.disabled: a command that cannot be used now is unavailable and not disabled, so that the keyboard reaches it and says why: Open in browser and Copy address of a forward that does not run, Stop of a forward whose plugin stopped and of
      // one that is stopping; pressed, it makes no call; and a command that can be used is not unavailable.
      {
        const problems = [];
        const unavailable = [
          ['proxy', 'Open in browser', NOT_RUNNING],
          ['proxy', 'Copy address', NOT_RUNNING],
          ['jobs', 'Open in browser', OPEN_UNSTATED],
          ['gateway', 'Copy address', NOT_RUNNING],
          ['queue', 'Stop', REASON_PLUGIN],
          ['queue', 'Open in browser', OPEN_UNSTATED],
          ['db', 'Open in browser', OPEN_UNSTATED],
          ['cache', 'Open in browser', OPEN_BEYOND],
          ['worker', 'Stop', 'Waiting for the stop to finish.'],
        ];
        // A command is found by what it does (its `data-ports-action`), and not by its name: the name is `ports.buttons`' to hold.
        const ACTION = { Stop: 'stop', 'Open in browser': 'open', 'Copy address': 'copy' };
        for (const [id, name, reason] of unavailable) {
          const button = rowOf(read, id)?.buttons.find((entry) => entry.action === ACTION[name]);
          if (button === undefined) problems.push(`${id} has no ${name}`);
          else {
            if (!button.disabled) problems.push(`${name} of ${id} is not unavailable`);
            if (button.native) problems.push(`${name} of ${id} is disabled, so the keyboard cannot reach it`);
            if (button.description !== reason) problems.push(`${name} of ${id} is described by ${JSON.stringify(button.description)}, not ${JSON.stringify(reason)}`);
          }
        }

        for (const [id, name] of [['api', 'Stop'], ['api', 'Open in browser'], ['api', 'Copy address'], ['payments', 'Stop'], ['dns', 'Copy address']]) {
          if (rowOf(read, id)?.buttons.find((entry) => entry.action === ACTION[name])?.disabled !== false) problems.push(`${name} of ${id} is unavailable, and it can be used`);
        }

        const before = await callsOf(page);
        for (const [id, name] of unavailable) await press(problems, buttonOf(page, id, name), `${name} of ${id}`);
        await frames(page, 3);
        const after = await callsOf(page);
        if (JSON.stringify(before) !== JSON.stringify(after)) problems.push(`pressing them made calls: ${JSON.stringify(before)}, then ${JSON.stringify(after)}`);
        const reached = await page.evaluate(() => {
          const button = window.__t.row('proxy')?.querySelector('[data-ports-action="open"]');
          button?.focus();
          return document.activeElement === button;
        });
        if (!reached) problems.push('the keyboard cannot reach an unavailable command');
        check('ports.disabled', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // ports.udp: a forward over UDP is not offered Open in browser (a browser speaks TCP only), and its Stop and its Copy address stand where they do in every other row, the place of the missing one held.
      {
        const problems = [];
        const udp = rowOf(read, 'dns');
        const tcp = rowOf(read, 'api');
        if (JSON.stringify(udp?.buttons.map((button) => button.label)) !== JSON.stringify(labelsOf('dns'))) problems.push(`the commands of a forward over UDP are ${JSON.stringify(udp?.buttons.map((button) => button.label))}`);
        if (JSON.stringify(udp?.group?.slots) !== JSON.stringify(['button', 'span:hidden', 'button'])) problems.push(`its group is ${JSON.stringify(udp?.group?.slots)}: a box that is not drawn holds the place of Open in browser`);
        for (const action of ['stop', 'copy']) {
          const there = udp?.buttons.find((button) => button.action === action)?.rect?.[0];
          const here = tcp?.buttons.find((button) => button.action === action)?.rect?.[0];
          if (!near(there, here)) problems.push(`${action} stands at ${String(there)} for UDP and at ${String(here)} for TCP`);
        }

        check('ports.udp', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // ports.open: Open in browser calls the way the window gives to open an address, once for a press (the pointer, and Enter on the focused button), with `http://127.0.0.1:<local port>` of its own row.
      {
        const problems = [];
        const calls = async () => (await callsOf(page)).opened;
        const press = async (done) => {
          await done();
          await frames(page, 3);
        };

        await press(async () => buttonOf(page, 'api', 'Open in browser').click());
        let got = await calls();
        if (JSON.stringify(got) !== JSON.stringify(['http://127.0.0.1:8081'])) problems.push(`a press on the first forward opened ${JSON.stringify(got)}`);
        await press(async () => buttonOf(page, 'payments', 'Open in browser').click());
        got = await calls();
        if (JSON.stringify(got) !== JSON.stringify(['http://127.0.0.1:8081', 'http://127.0.0.1:8100'])) problems.push(`a press on another forward made the calls ${JSON.stringify(got)}`);
        await buttonOf(page, 'api', 'Open in browser').focus();
        await press(async () => page.keyboard.press('Enter'));
        got = await calls();
        if (got.length !== 3 || got[2] !== 'http://127.0.0.1:8081') problems.push(`Enter on the focused button made the calls ${JSON.stringify(got)}`);
        check('ports.open', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // ports.copy: Copy address puts `127.0.0.1:<local port>` on the clipboard once, says "Address copied" once through a polite live region that was in the page before, draws the mock's check mark on that button alone, and goes back to the copy glyph by itself.
      {
        const problems = [];
        const region = await page.evaluate(() => {
          const live = window.__t.body()?.querySelector('[data-ports-part="live"]');
          return live === null || live === undefined ? null : { role: live.getAttribute('role'), live: live.getAttribute('aria-live'), text: live.textContent };
        });
        if (region === null || region.role !== 'status' || region.live !== 'polite' || region.text !== '') problems.push(`the live region before anything is said is ${JSON.stringify(region)}`);
        await buttonOf(page, 'api', 'Copy address').click();
        await waitFor(page, () => window.__clip.writes.length >= 1 && window.__t.told.length >= 1, null, 6000);
        await frames(page, 3);
        const first = await page.evaluate(() => ({
          writes: window.__clip.writes.slice(),
          told: window.__t.told.slice(),
          live: window.__t.live(),
          glyph: window.__t.readRow(window.__t.row('api')).buttons.find((button) => button.action === 'copy').glyph,
          others: window.__t.rows().filter((row) => row.dataset.portsId !== 'api').map((row) => window.__t.readRow(row).buttons.find((button) => button.action === 'copy').glyph),
        }));
        if (JSON.stringify(first.writes) !== JSON.stringify(['127.0.0.1:8081'])) problems.push(`the clipboard was given ${JSON.stringify(first.writes)}`);
        if (JSON.stringify(first.told) !== JSON.stringify(['Address copied'])) problems.push(`the live region was told ${JSON.stringify(first.told)}`);
        if (first.live !== 'Address copied') problems.push(`the live region holds ${JSON.stringify(first.live)}`);
        if (mock?.copy !== undefined && (JSON.stringify(mock.copy.told) !== JSON.stringify(first.told) || JSON.stringify(mock.copy.clip) !== JSON.stringify(first.writes))) problems.push(`the mock said ${JSON.stringify(mock.copy.told)} and copied ${JSON.stringify(mock.copy.clip)}`);
        if (first.glyph !== 'check' || (mock?.copy !== undefined && glyphs[mock.copy.during[0]] !== first.glyph)) problems.push(`the button draws ${JSON.stringify(first.glyph)} for a moment, the mock draws ${String(mock?.copy.during[0])}`);
        if (first.others.some((glyph) => glyph !== 'copy')) problems.push(`another row's button changed: ${JSON.stringify(first.others)}`);
        const back = await waitFor(page, () => window.__t.readRow(window.__t.row('api')).buttons.find((button) => button.action === 'copy').glyph === 'copy', null, 8000);
        if (!back) problems.push('the check mark never went back to the copy glyph');
        await buttonOf(page, 'payments', 'Copy address').click();
        await waitFor(page, () => window.__clip.writes.length >= 2 && window.__t.told.length >= 2, null, 6000);
        await frames(page, 3);
        const second = await page.evaluate(() => ({ writes: window.__clip.writes.slice(), told: window.__t.told.slice() }));
        if (JSON.stringify(second.writes) !== JSON.stringify(['127.0.0.1:8081', '127.0.0.1:8100'])) problems.push(`a second press copied ${JSON.stringify(second.writes)}`);
        if (JSON.stringify(second.told) !== JSON.stringify(['Address copied', 'Address copied'])) problems.push(`and the live region was told ${JSON.stringify(second.told)}`);
        check('ports.copy', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // ports.stop: Stop asks the host to close that forward once (the id of its row), the row says Stopping at once and its Stop says it waits, a second press asks nothing more, and when the host has closed it the row is gone, the count is one less and
      // the live region says so once.
      {
        const problems = [];
        const count = async () => page.evaluate(() => window.__t.count()?.textContent ?? null);
        const rows = (await page.evaluate(() => window.__t.ids())).length;
        const before = (await callsOf(page)).closed;
        await buttonOf(page, 'cache', 'Stop').click();
        await waitFor(page, (length) => window.__ports.closes.ids().length > length, before.length, 6000);
        await frames(page, 3);
        const made = (await callsOf(page)).closed.slice(before.length);
        if (JSON.stringify(made) !== JSON.stringify(['cache'])) problems.push(`a press of Stop on the last forward asked the host to close ${JSON.stringify(made)}`);
        const stopping = await page.evaluate(() => {
          const row = window.__t.readRow(window.__t.row('cache'));
          return { word: row.status?.word, state: row.state, stop: row.buttons.find((button) => button.action === 'stop') };
        });
        if (stopping.word !== 'Stopping' || stopping.state !== 'stopping') problems.push(`the row says ${JSON.stringify(stopping.word)} (${String(stopping.state)}) while it waits`);
        if (stopping.stop?.disabled !== true || stopping.stop.description !== 'Waiting for the stop to finish.') problems.push(`its Stop is ${JSON.stringify(stopping.stop)} while it waits`);
        await press(problems, buttonOf(page, 'cache', 'Stop'), 'Stop of the forward that is stopping');
        await frames(page, 3);
        const again = (await callsOf(page)).closed.slice(before.length);
        if (JSON.stringify(again) !== JSON.stringify(made)) problems.push(`a second press asked the host ${JSON.stringify(again)}`);
        await page.evaluate(() => {
          window.__ports.closes.answer('ok', 'cache');
        });
        const gone = await waitFor(page, () => !window.__t.ids().includes('cache'), null, 6000);
        if (!gone) problems.push('the row is still there when the host has closed the forward');
        await waitFor(page, (want) => (window.__t.count()?.textContent ?? '').startsWith(want), `${String(rows - 1)} forwards`, 6000);
        if (!((await count()) ?? '').startsWith(`${String(rows - 1)} forwards`)) problems.push(`the footer counts ${JSON.stringify(await count())}, not ${String(rows - 1)} forwards`);
        const said = (await page.evaluate(() => window.__t.told.slice())).filter((words) => words.startsWith('Stopped'));
        if (JSON.stringify(said) !== JSON.stringify([`Stopped ${mappingOf(SET.find((entry) => entry.id === 'cache'))}`])) problems.push(`the live region was told ${JSON.stringify(said)}`);
        // A forward the host has already closed: the host says it has no such forward, which is an end and not a refusal, so the row is gone with no second line and the live region says it stopped.
        await page.evaluate(() => {
          window.__ports.closes.mode = 'gone';
        });
        await buttonOf(page, 'db', 'Stop').click();
        const closed = await waitFor(page, () => !window.__t.ids().includes('db'), null, 6000);
        if (!closed) problems.push('a forward the host has no more is still there after Stop');
        const refusals = await page.evaluate(() => window.__t.rows().filter((row) => row.querySelector('[data-ports-part="reason"]') !== null).map((row) => row.dataset.portsId));
        if (refusals.some((id) => id !== 'queue')) problems.push(`a forward the host has no more is said to have refused: ${JSON.stringify(refusals)}`);
        const vanished = (await page.evaluate(() => window.__t.told.slice())).filter((words) => words.startsWith('Stopped'));
        if (!vanished.includes(`Stopped ${mappingOf(SET.find((entry) => entry.id === 'db'))}`)) problems.push(`and the live region was told ${JSON.stringify(vanished)}`);
        check('ports.stop', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      report.numbers[`actions ${tag}`] = await callsOf(page);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ menu
  /** The row menu opened by the pointer: a secondary click on the row's mapping. */
  const openByPointer = async (page, id) => {
    const cell = page.locator(`[data-ports-id="${id}"] [data-column="mapping"]`);
    await cell.scrollIntoViewIfNeeded();
    await stillTable(page);
    await cell.click({ button: 'right' });
    return menuShown(page);
  };

  /** A button of a row has the keyboard, and the table is still: the keyboard opens the menu from it. */
  const focusSteady = async (page, id, name) => {
    await buttonOf(page, id, name).focus();
    await stillTable(page);
  };

  sections.menu = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await page.evaluate(() => {
        window.__t.watch();
      });
      await reach(page, { tall: true });
      await stage(page);
      const labels = ['Stop', 'Open in browser', 'Copy address'];

      // menu.items: a secondary click on a row opens its menu on the window's menu host, named for the forward: Stop, Open in browser and Copy address (two for a forward over UDP), none of them drawing a shortcut, each unavailable where its button is; an item does what its button does.
      {
        const problems = [];
        const expectMenu = (name, menu, items, disabled = []) => {
          if (menu === null) {
            problems.push(`${name}: no menu opened`);
            return;
          }

          if (JSON.stringify(menu.items.map((item) => item.label)) !== JSON.stringify(items)) problems.push(`${name}: the items are ${JSON.stringify(menu.items.map((item) => item.label))}, not ${JSON.stringify(items)}`);
          const off = menu.items.filter((item) => item.disabled).map((item) => item.label);
          if (JSON.stringify(off) !== JSON.stringify(disabled)) problems.push(`${name}: ${JSON.stringify(off)} are unavailable, not ${JSON.stringify(disabled)}`);
          const drawn = menu.items.filter((item) => item.text !== item.label).map((item) => `${String(item.label)} draws ${JSON.stringify(item.text)}`);
          if (drawn.length > 0) problems.push(`${name}: an item draws more than its name (${drawn.join(', ')})`);
        };

        let menu = await openByPointer(page, 'api');
        if (menu?.label !== `Actions for ${subjectOf('api')}`) problems.push(`the menu of the first forward is named ${JSON.stringify(menu?.label)}`);
        await perturb(ctx, page, 'open');
        menu = await menuNow(page);
        expectMenu('a forward that runs', menu, labels);
        await page.keyboard.press('Escape');
        await menuShown(page, false);
        menu = await openByPointer(page, 'dns');
        expectMenu('a forward over UDP', menu, labelsOf('dns'));
        await page.keyboard.press('Escape');
        await menuShown(page, false);
        menu = await openByPointer(page, 'proxy');
        expectMenu('a forward that failed', menu, labels, ['Open in browser', 'Copy address']);
        await page.keyboard.press('Escape');
        await menuShown(page, false);
        menu = await openByPointer(page, 'queue');
        expectMenu('a forward whose plugin stopped', menu, labelsOf('queue'), labelsOf('queue'));
        await page.keyboard.press('Escape');
        await menuShown(page, false);
        // What an item does.
        const before = await callsOf(page);
        await openByPointer(page, 'api');
        await page.getByRole('menuitem', { name: 'Copy address', exact: true }).click();
        await menuShown(page, false);
        await waitFor(page, (length) => window.__clip.writes.length > length, before.copied.length, 6000);
        await openByPointer(page, 'payments');
        await page.getByRole('menuitem', { name: 'Open in browser', exact: true }).click();
        await menuShown(page, false);
        await waitFor(page, (length) => window.__ports.opened.length > length, before.opened.length, 6000);
        await openByPointer(page, 'cache');
        await page.getByRole('menuitem', { name: 'Stop', exact: true }).click();
        await menuShown(page, false);
        await waitFor(page, (length) => window.__ports.closes.ids().length > length, before.closed.length, 6000);
        await frames(page, 3);
        const after = await callsOf(page);
        if (JSON.stringify(after.copied.slice(before.copied.length)) !== JSON.stringify(['127.0.0.1:8081'])) problems.push(`the item Copy address copied ${JSON.stringify(after.copied.slice(before.copied.length))}`);
        if (JSON.stringify(after.opened.slice(before.opened.length)) !== JSON.stringify(['http://127.0.0.1:8100'])) problems.push(`the item Open in browser opened ${JSON.stringify(after.opened.slice(before.opened.length))}`);
        if (JSON.stringify(after.closed.slice(before.closed.length)) !== JSON.stringify(['cache'])) problems.push(`the item Stop closed ${JSON.stringify(after.closed.slice(before.closed.length))}`);
        // An item that is unavailable does nothing.
        await openByPointer(page, 'proxy');
        await press(problems, page.getByRole('menuitem', { name: 'Open in browser', exact: true }), 'the item Open in browser of a forward that does not run');
        await frames(page, 3);
        const unavailable = await callsOf(page);
        if (JSON.stringify(unavailable) !== JSON.stringify(after)) problems.push(`an item that is unavailable made calls: ${JSON.stringify(unavailable)}`);
        await page.keyboard.press('Escape');
        // What a page does with the keyboard after an Escape is done before the next assertion starts: a few frames.
        await frames(page, 3);
        check('menu.items', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // menu.keys: Shift F10 and the Menu key, on a button of a row, open the menu of that row with the first item focused.
      {
        const problems = [];
        const cases = [
          ['jobs', copyLabelOf('jobs'), 'Shift+F10', labelsOf('jobs')],
          ['gateway', 'Open in browser', 'ContextMenu', labels],
          ['dns', 'Stop', 'Shift+F10', labelsOf('dns')],
        ];
        for (const [id, name, key, items] of cases) {
          await focusSteady(page, id, name);
          await page.keyboard.press(key);
          const menu = await menuShown(page, true, 4000);
          if (menu === null) problems.push(`${key} on ${name} of ${id} opened no menu`);
          else {
            if (menu.label !== `Actions for ${subjectOf(id)}`) problems.push(`${key} on ${name} of ${id} opened the menu ${JSON.stringify(menu.label)}`);
            if (JSON.stringify(menu.items.map((item) => item.label)) !== JSON.stringify(items)) problems.push(`${key} on ${name} of ${id} opened the items ${JSON.stringify(menu.items.map((item) => item.label))}`);
            if (menu.focused !== 'Stop') problems.push(`${key} on ${name} of ${id} focused ${JSON.stringify(menu.focused)}, not the first item`);
          }

          await page.keyboard.press('Escape');
          await menuShown(page, false, 4000);
          await frames(page, 3);
        }

        check('menu.keys', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // menu.escape: Escape puts the menu away and gives the keyboard back to where it came from: the button it was opened on (by Shift F10 and by the Menu key), and for a menu the pointer opened, the table (never the page).
      {
        const problems = [];
        for (const [id, name, key] of [['jobs', copyLabelOf('jobs'), 'Shift+F10'], ['gateway', 'Open in browser', 'ContextMenu']]) {
          await focusSteady(page, id, name);
          await page.keyboard.press(key);
          const opened = await menuShown(page, true, 4000);
          if (opened === null) {
            problems.push(`${key} on ${name} of ${id} opened no menu, so Escape was not tested`);
            continue;
          }

          await page.keyboard.press('Escape');
          const gone = (await menuShown(page, false, 4000)) === null;
          // The keyboard comes back to the button the menu was opened on, and stays there: it is read when it has come and again after a few frames.
          await waitFor(page, (want) => window.__t.active()?.row === want.id && window.__t.active()?.label === want.name, { id, name }, 4000);
          await frames(page, 15);
          const where = await activeNow(page);
          if (!gone) problems.push(`Escape did not put the menu away (${key} on ${name} of ${id})`);
          if (where?.row !== id || where.label !== name) problems.push(`after Escape the keyboard is on ${JSON.stringify(where?.label)} of ${JSON.stringify(where?.row)}, not on ${name} of ${id}`);
        }

        await page.evaluate(() => {
          document.activeElement?.blur();
        });
        const pointerMenu = await openByPointer(page, 'proxy');
        if (pointerMenu === null) problems.push('a secondary click on a row opened no menu, so Escape was not tested');
        await page.keyboard.press('Escape');
        const stayed = await menuShown(page, false, 4000);
        if (pointerMenu !== null && stayed !== null) problems.push('Escape did not put away the menu the pointer opened');
        await waitFor(page, () => window.__t.active()?.inBody === true, null, 4000);
        await frames(page, 15);
        const where = await activeNow(page);
        if (pointerMenu !== null && (where === null || where.page || !where.inBody)) problems.push(`after Escape on a menu the pointer opened the keyboard is ${JSON.stringify(where)}, not in the table`);
        check('menu.escape', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ keyboard
  sections.keyboard = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await reach(page, { tall: true });
      await perturb(ctx, page, 'ready');
      const tab = tabKey(engine);
      const ids = SET.map((entry) => entry.id);

      // keys.tabstop: the commands of a row are ONE Tab stop (its first button): from the table's own scroller Tab goes row by row, one stop for each, and leaves the table after the last; Shift Tab goes back the same way.
      {
        const problems = [];
        await page.evaluate(() => {
          window.__t.body()?.firstElementChild?.focus();
        });
        const seen = [];
        for (let press = 0; press <= ids.length; press += 1) {
          await page.keyboard.press(tab);
          seen.push(await activeNow(page));
        }

        ids.forEach((id, index) => {
          if (seen[index]?.row !== id || seen[index].action !== 'stop') problems.push(`Tab ${String(index + 1)} reached ${JSON.stringify(seen[index]?.label)} of ${JSON.stringify(seen[index]?.row)}, not Stop of ${id}`);
        });
        if (seen[ids.length]?.row !== null) problems.push(`Tab ${String(ids.length + 1)} is still in a row (${JSON.stringify(seen[ids.length]?.row)}): the table is left after its last row`);
        await buttonOf(page, ids.at(-1), 'Stop').focus();
        await page.keyboard.press(`Shift+${tab}`);
        const back = await activeNow(page);
        if (back?.row !== ids.at(-2) || back.action !== 'stop') problems.push(`Shift Tab from the last row is on ${JSON.stringify(back?.action)} of ${JSON.stringify(back?.row)}, not Stop of ${String(ids.at(-2))}`);
        check('keys.tabstop', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }

      // keys.arrows: inside a row the arrows move between its buttons without wrapping, Home and End go to the ends, Tab leaves the row for the next row's stop, and Shift Tab comes back to the button the row last had.
      {
        const problems = [];
        const steps = [];
        const press = async (key) => {
          await page.keyboard.press(key);
          const where = await activeNow(page);
          steps.push(`${key}: ${String(where?.action)} of ${String(where?.row)}`);
          return where;
        };

        await buttonOf(page, 'api', 'Stop').focus();
        const expectAt = (where, row, action, what) => {
          if (where?.row !== row || where.action !== action) problems.push(`${what}: the keyboard is on ${String(where?.action)} of ${String(where?.row)}, not ${action} of ${row}`);
        };

        expectAt(await press('ArrowRight'), 'api', 'open', 'ArrowRight from Stop');
        expectAt(await press('ArrowRight'), 'api', 'copy', 'ArrowRight again');
        expectAt(await press('ArrowRight'), 'api', 'copy', 'ArrowRight at the end');
        expectAt(await press('Home'), 'api', 'stop', 'Home');
        expectAt(await press('ArrowLeft'), 'api', 'stop', 'ArrowLeft at the start');
        expectAt(await press('End'), 'api', 'copy', 'End');
        expectAt(await press(tab), 'dns', 'stop', 'Tab from the end of a row');
        expectAt(await press('ArrowRight'), 'dns', 'copy', 'ArrowRight in a row of UDP (the place of Open in browser is not a stop)');
        expectAt(await press(`Shift+${tab}`), 'api', 'copy', 'Shift Tab from a row that had the end of its neighbour: the stop of that row is the button it last had');
        check('keys.arrows', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')} (${steps.join(', ')})`);
      }

      // keys.next: when the row that has the keyboard goes (Stop ended it) the keyboard is not lost to the page: it goes to the row that took its place, else the row before, else the tool's own tab; and it does the same when the row goes under its own open menu.
      {
        const problems = [];
        const stopAt = async (id) => {
          await buttonOf(page, id, 'Stop').focus();
          await page.keyboard.press('Enter');
          const removed = await waitFor(page, (gone) => !window.__t.ids().includes(gone), id, 6000);
          if (!removed) problems.push(`Stop of ${id} did not take its row away`);
          await frames(page, 3);
          return activeNow(page);
        };

        let where = await stopAt('jobs');
        if (where?.row !== 'gateway' || where.tag !== 'BUTTON') problems.push(`a middle row went and the keyboard is on ${JSON.stringify(where?.label)} of ${JSON.stringify(where?.row)}, not on the row that took its place (gateway)`);
        where = await stopAt('cache');
        if (where?.row !== 'db' || where.tag !== 'BUTTON') problems.push(`the last row went and the keyboard is on ${JSON.stringify(where?.label)} of ${JSON.stringify(where?.row)}, not on the row before (db)`);
        // The row goes under its own menu: the host closes it (its event), and the menu is put away.
        await buttonOf(page, 'proxy', 'Stop').focus();
        await page.keyboard.press('Shift+F10');
        const underMenu = await menuShown(page, true, 4000);
        if (underMenu === null) problems.push('Shift F10 on the proxy row opened no menu, so the removal of a row under its menu was not tested');
        await page.evaluate((session) => {
          window.__ports.emit('core/networker/portforward/closed', session);
        }, SET.find((entry) => entry.id === 'proxy'));
        const settled = await waitFor(page, () => !window.__t.ids().includes('proxy') && window.__t.menu() === null, null, 6000);
        if (underMenu !== null && !settled) problems.push('the row that went under its own menu is still there, or its menu was not put away');
        await frames(page, 3);
        where = await activeNow(page);
        if (underMenu !== null && (where?.row !== 'worker' || where.tag !== 'BUTTON')) problems.push(`a row went under its menu and the keyboard is on ${JSON.stringify(where?.label)} of ${JSON.stringify(where?.row)}, not on the row that took its place (worker)`);
        // The only row.
        await page.context().close();
        const alone = await openPage(ctx);
        try {
          await reach(alone, { sessions: [SET[0]], tall: true });
          await perturb(ctx, alone, 'ready');
          await alone.locator('[data-ports-id="api"]').getByRole('button', { name: 'Stop', exact: true }).focus();
          await alone.keyboard.press('Enter');
          const removedAlone = await waitFor(alone, () => window.__t.ids().length === 0, null, 6000);
          if (!removedAlone) problems.push('Stop of the only row did not take it away');
          await frames(alone, 3);
          where = await activeNow(alone);
          if (where?.tab !== true || where.tabName !== 'Ports') problems.push(`the only row went and the keyboard is on ${JSON.stringify(where?.label ?? where?.tag)}, not on the Ports tab`);
        } finally {
          await alone.context().close();
        }

        check('keys.next', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      }
    } finally {
      await page.context().close().catch(() => undefined);
    }
  };

  // ------------------------------------------------------------------------------------------------ empty, loading, failed
  /** Every control the window offers that is named like the start of a forward: the tool starts none, so it is none. */
  const startButtons = async (page) =>
    page.evaluate(() => [...document.querySelectorAll('button, [role="button"], a, [role="menuitem"], [role="tab"]')].map((element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim()).filter((name) => /forward\s+(a\s+)?port/i.test(name)));

  sections.empty = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const mock = reference()?.data?.[engine]?.[vp];

    // ports.empty: with nothing listed the tool says what is missing and how a forward arrives, in the mock's words, as a status, with the count of none in the footer, no table and NO button that starts a forward, in the tool or anywhere in the window.
    {
      const page = await openPage(ctx);
      try {
        await reach(page, { sessions: [], rows: false });
        await waitFor(page, () => window.__t.body()?.dataset.portsStatus === 'ready', null, 8000);
        await perturb(ctx, page, 'empty');
        const problems = [];
        const read = await page.evaluate(() => {
          const body = window.__t.body();
          const empty = body?.querySelector('[data-shell-part="panelEmpty"]') ?? null;
          const box = (element) => {
            if (element === null) return null;
            const rect = element.getBoundingClientRect();
            return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100);
          };

          const paragraphs = [...(empty?.querySelectorAll('p') ?? [])].map((paragraph) => ({ text: (paragraph.textContent ?? '').trim(), rect: box(paragraph), size: getComputedStyle(paragraph).fontSize, weight: getComputedStyle(paragraph).fontWeight, line: getComputedStyle(paragraph).lineHeight, color: getComputedStyle(paragraph).color }));
          const full = window.__t.read();
          return { role: empty?.getAttribute('role') ?? null, paragraphs, glyph: box(empty?.querySelector('svg') ?? null), buttons: [...(body?.querySelectorAll('button, [role="button"], a') ?? [])].map((element) => (element.textContent ?? '').trim()), table: window.__t.table() !== null, footer: full.footer, panel: full.panel, body: box(body) };
        });
        const [title, hint] = read.paragraphs;
        if (title?.text !== 'No forwarded ports' || hint?.text !== 'Forward a port of a resource to this computer.') problems.push(`the words are ${JSON.stringify(read.paragraphs.map((paragraph) => paragraph.text))}`);
        if (read.role !== 'status') problems.push(`the empty state has the role ${JSON.stringify(read.role)}, not status`);
        if (read.table) problems.push('a table is drawn');
        if (read.buttons.length > 0) problems.push(`the tool draws ${JSON.stringify(read.buttons)}: it has no button`);
        const starts = await startButtons(page);
        if (starts.length > 0) problems.push(`the window offers ${JSON.stringify(starts)}, which starts a forward`);
        if (read.footer?.count?.text !== '0 forwards') problems.push(`the footer counts ${JSON.stringify(read.footer?.count?.text)}, not 0 forwards`);
        const wanted = mock?.empty;
        if (wanted === undefined) problems.push('the mock is not measured (run mock-ports-measure.mjs)');
        else {
          const [mockTitle] = wanted.parts.filter((part) => part.text !== '' && part.tag !== 'button');
          if (`${title?.size} ${title?.weight} ${title?.color}` !== `${mockTitle.style['font-size']} ${mockTitle.style['font-weight']} ${mockTitle.style.color}`) problems.push(`the title is set in ${String(title?.size)} ${String(title?.weight)} ${String(title?.color)}, the mock's is ${mockTitle.style['font-size']} ${mockTitle.style['font-weight']} ${mockTitle.style.color}`);
          for (const [name, paragraph] of [['title', title], ['hint', hint]]) {
            if (paragraph?.rect !== null && paragraph !== undefined && read.body !== null && !near(paragraph.rect[0] + paragraph.rect[2] / 2, read.body[0] + read.body[2] / 2, 1)) problems.push(`the ${name} is not in the middle of the panel`);
          }

          if (read.footer === null || !near(read.footer.rect?.[3], wanted.footer.rect[3]) || !near((read.footer.rect?.[1] ?? 0) + (read.footer.rect?.[3] ?? 0), (read.panel?.[1] ?? 0) + (read.panel?.[3] ?? 0))) problems.push(`the footer is ${JSON.stringify(read.footer?.rect)}, the mock's lane is ${String(wanted.footer.rect[3])} px at the foot of the panel`);
          note(`empty ${tag}: the glyph is ${JSON.stringify(read.glyph?.slice(2))} (the mock's ${JSON.stringify(wanted.parts[0].rect.slice(2))}), the hint ${String(hint?.size)} (the mock's ${wanted.parts[2].style['font-size']}), the mock's button ${JSON.stringify(wanted.buttons.map((button) => button.text))} is not drawn`);
        }

        check('ports.empty', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);

        // ports.hint: the hint under the title of the empty state is the mock's second-line text: 12 px on 16, of its weight and its muted colour (and the hint of the state that could not be read is the same: one component says both).
        {
          const hintProblems = [];
          const mockHint = wanted?.parts.filter((part) => part.text !== '' && part.tag !== 'button')[1];
          if (mockHint === undefined) hintProblems.push('the mock is not measured (run mock-ports-measure.mjs)');
          else if (hint === undefined) hintProblems.push('the empty state has no hint');
          else {
            for (const [name, got, want] of [['size', hint.size, mockHint.style['font-size']], ['line height', hint.line, mockHint.style['line-height']], ['weight', hint.weight, mockHint.style['font-weight']], ['colour', hint.color, mockHint.style.color]]) {
              if (got !== want) hintProblems.push(`the hint's ${name} is ${String(got)}, the mock's is ${String(want)}`);
            }
          }

          check('ports.hint', hintProblems.length === 0, `${tag}: ${hintProblems.slice(0, 4).join('; ')}`);
        }
      } finally {
        await page.context().close();
      }
    }

    // ports.loading: until the host first answers the tool says that it is loading the forwarded ports, as a busy status that is a skeleton of the table, and draws no table, no count, no words of an empty list and no button; and the answer replaces it.
    {
      const page = await openPage(ctx, { query: 'read=hold' });
      try {
        await reach(page, { rows: false });
        await waitFor(page, () => window.__t.body()?.dataset.portsStatus === 'loading', null, 8000);
        await perturb(ctx, page, 'loading');
        const problems = [];
        const read = await page.evaluate(() => {
          const body = window.__t.body();
          const status = [...(body?.querySelectorAll('[role="status"]') ?? [])].filter((element) => element.getAttribute('aria-busy') === 'true');
          return { busy: status.map((element) => element.getAttribute('aria-label')), table: window.__t.table() !== null, footer: body?.querySelector('[data-ports-part="footer"]') !== null, words: /No forwarded ports|Forward a port of a resource|Couldn't read/.test(body?.textContent ?? ''), buttons: body?.querySelectorAll('button').length ?? 0, held: window.__ports.reads.held() };
        });
        if (JSON.stringify(read.busy) !== JSON.stringify(['Loading forwarded ports'])) problems.push(`the busy statuses are ${JSON.stringify(read.busy)}`);
        if (read.table) problems.push('a table is drawn while the host has not answered');
        if (read.footer) problems.push('a count is drawn while the host has not answered: nothing is known yet');
        if (read.words) problems.push('the words of an empty or a failed list are drawn');
        if (read.buttons > 0) problems.push(`${String(read.buttons)} buttons are drawn`);
        if (read.held !== 1) problems.push(`the host was asked ${String(read.held)} times, not once`);
        await page.evaluate((sessions) => {
          window.__ports.set(sessions);
          window.__ports.reads.answer();
        }, SET);
        const answered = await waitFor(page, (count) => window.__t.ids().length === count && window.__t.body()?.querySelector('[aria-busy="true"]') === null, SET.length, 8000);
        if (!answered) problems.push('the answer of the host did not replace the skeleton with the table');
        check('ports.loading', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      } finally {
        await page.context().close();
      }
    }

    // ports.failed: when the host cannot be read the tool says so in plain words and offers Try again, its only button, which asks the host ONCE more, shows loading, and then shows what the host says; no button that starts a forward anywhere.
    {
      const page = await openPage(ctx, { query: 'read=fail&fails=1' });
      try {
        await reach(page, { rows: false });
        await waitFor(page, () => window.__t.body()?.dataset.portsStatus === 'failed', null, 8000);
        const problems = [];
        const read = await page.evaluate(() => {
          const body = window.__t.body();
          return { text: [...(body?.querySelectorAll('p') ?? [])].map((paragraph) => (paragraph.textContent ?? '').trim()), buttons: [...(body?.querySelectorAll('button') ?? [])].map((button) => (button.textContent ?? '').trim()), table: window.__t.table() !== null, footer: body?.querySelector('[data-ports-part="footer"]') !== null, listed: window.__ports.reads.listed() };
        });
        if (JSON.stringify(read.text) !== JSON.stringify(["Couldn't read the port forwards.", 'Forwards that are running are not affected.'])) problems.push(`the words are ${JSON.stringify(read.text)}`);
        if (JSON.stringify(read.buttons) !== JSON.stringify(['Try again'])) problems.push(`the buttons are ${JSON.stringify(read.buttons)}, not Try again alone`);
        if (read.table || read.footer) problems.push('a table or a count is drawn for a list that could not be read');
        if (read.listed !== 1) problems.push(`the host was asked ${String(read.listed)} times before Try again`);
        const hintStyle = await page.evaluate(() => {
          const hint = [...document.querySelectorAll('[data-shell-part="portsBody"] [data-shell-part="panelEmpty"] p')][1];
          if (hint === undefined) return null;
          const style = getComputedStyle(hint);
          return { size: style.fontSize, line: style.lineHeight, weight: style.fontWeight, color: style.color };
        });
        const mockHint = mock?.empty.parts.filter((part) => part.text !== '' && part.tag !== 'button')[1];
        const failedHint = hintStyle === null || mockHint === undefined ? ['no hint, or the mock is not measured'] : [['size', hintStyle.size, mockHint.style['font-size']], ['line height', hintStyle.line, mockHint.style['line-height']], ['weight', hintStyle.weight, mockHint.style['font-weight']], ['colour', hintStyle.color, mockHint.style.color]].filter(([, got, want]) => got !== want).map(([name, got, want]) => `the hint's ${name} is ${String(got)}, the mock's is ${String(want)}`);
        check('ports.hint', failedHint.length === 0, `${tag}: the hint of the state that could not be read: ${failedHint.join('; ')}`);
        const starts = await startButtons(page);
        if (starts.length > 0) problems.push(`the window offers ${JSON.stringify(starts)}, which starts a forward`);
        await page.evaluate((sessions) => {
          window.__ports.set(sessions);
          window.__ports.reads.mode = 'hold';
        }, SET);
        await page.getByRole('button', { name: 'Try again', exact: true }).click();
        const loading = await waitFor(page, () => window.__ports.reads.listed() >= 2 && window.__t.body()?.dataset.portsStatus === 'loading', null, 6000);
        if (!loading) problems.push(`Try again did not show loading while the second read was held: the status is ${JSON.stringify(await page.evaluate(() => window.__t.body()?.dataset.portsStatus ?? null))} and the host was asked ${String(await page.evaluate(() => window.__ports.reads.listed()))} times`);
        await page.evaluate(() => {
          window.__ports.reads.answer();
        });
        const answered = await waitFor(page, (count) => window.__t.ids().length === count, SET.length, 8000);
        await frames(page, 3);
        const listed = await page.evaluate(() => window.__ports.reads.listed());
        if (!answered) problems.push('Try again did not end in the table');
        if (listed !== 2) problems.push(`Try again asked the host ${String(listed - 1)} times, not once`);
        check('ports.failed', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      } finally {
        await page.context().close();
      }
    }
  };

  // ------------------------------------------------------------------------------------------------ footer
  // ports.footerwords: the footer counts the forwards in words (`1 forward`, `10 forwards`, `0 forwards`) and says how many of them are stopping after the count, ` · <k> stopping`, only while some row is Stopping and never otherwise.
  sections.footer = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const problems = [];
    const says = async (page, step, want) => {
      await waitFor(page, (words) => (window.__t.count()?.textContent ?? '') === words, want, problems.length === 0 ? 4000 : 300);
      const got = await page.evaluate(() => window.__t.count()?.textContent ?? null);
      if (got !== want) problems.push(`${step}: the footer says ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
    };

    const alone = await openPage(ctx);
    try {
      await reach(alone, { sessions: [SET[0]] });
      await perturb(ctx, alone, 'single');
      await says(alone, 'one forward', '1 forward');
      await alone.evaluate(() => {
        window.__ports.closes.mode = 'hold';
      });
      await buttonOf(alone, 'api', 'Stop').click();
      await says(alone, 'one forward that is stopping', '1 forward · 1 stopping');
      await alone.evaluate(() => {
        window.__ports.closes.answer('ok', 'api');
      });
      await says(alone, 'the forward is closed', '0 forwards');
    } finally {
      await alone.context().close();
    }

    const many = await openPage(ctx);
    try {
      await reach(many);
      await says(many, 'ten forwards', '10 forwards');
      await many.evaluate(() => {
        window.__ports.closes.mode = 'hold';
      });
      await buttonOf(many, 'api', 'Stop').click();
      await buttonOf(many, 'dns', 'Stop').click();
      await says(many, 'two are stopping', '10 forwards · 2 stopping');
      await many.evaluate(() => {
        window.__ports.closes.answer('ok', 'api');
      });
      await says(many, 'one is closed and one is stopping', '9 forwards · 1 stopping');
      await many.evaluate(() => {
        window.__ports.closes.answer('refuse', 'dns');
      });
      await waitFor(many, () => window.__t.stateOf('dns') === 'running', null, 4000);
      await perturb(ctx, many, 'settled');
      await says(many, 'the other is refused, so nothing is stopping', '9 forwards');
    } finally {
      await many.context().close();
    }

    check('ports.footerwords', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
  };

  // ------------------------------------------------------------------------------------------------ cost
  const REST_MS = 1500;
  const pause = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ports.idle: a table at rest costs nothing: in the production build no timer, no interval and no frame is asked for and the document does not change, and in the development build, where the profiler reports, no commit is made.
  sections.idle = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const rest = async (page, dev) => {
      await reach(page);
      await perturb(ctx, page, 'idle');
      await frames(page, 3);
      // The development build's profiler has to be counting, or a count of none at rest says nothing: the tool has mounted, and mounting is a commit.
      const mounted = dev ? await page.evaluate(() => window.__commits.length) : null;
      // The forwards are drawn before the rest is measured, in either build: a table that is not there costs nothing.
      const drawn = await page.evaluate(() => [...window.__t.ids()].sort());
      await page.evaluate(() => {
        Object.assign(window.__count, { on: true, timeout: 0, interval: 0, raf: 0, fired: 0 });
        window.__rest = { mutations: 0, commits: window.__commits.length };
        window.__observer = new MutationObserver((list) => {
          window.__rest.mutations += list.length;
        });
        window.__observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      });
      await pause(REST_MS);
      const sampled = await page.evaluate((development) => {
        window.__count.on = false;
        window.__observer.disconnect();
        return { timeout: window.__count.timeout, interval: window.__count.interval, raf: window.__count.raf, fired: window.__count.fired, active: window.__count.active, mutations: window.__rest.mutations, commits: development ? window.__commits.length - window.__rest.commits : null };
      }, dev);
      return { ...sampled, mounted, drawn };
    };

    const production = await openPage(ctx);
    let made;
    try {
      made = await rest(production, false);
    } finally {
      await production.context().close();
    }

    const development = await openPage(ctx, { dev: true });
    let committed;
    try {
      committed = await rest(development, true);
    } finally {
      await development.context().close();
    }

    const problems = [];
    if (made.timeout !== 0 || made.interval !== 0 || made.active !== 0 || made.fired !== 0) problems.push(`the production build asked for ${String(made.timeout)} timers and ${String(made.interval)} intervals (${String(made.active)} alive, ${String(made.fired)} callbacks fired)`);
    if (made.raf !== 0) problems.push(`it asked for ${String(made.raf)} frames`);
    if (made.mutations !== 0) problems.push(`it changed the document ${String(made.mutations)} times`);
    const wantedRows = SET.map((entry) => entry.id).sort();
    for (const [build, run] of [['production', made], ['development', committed]]) {
      if (JSON.stringify(run.drawn) !== JSON.stringify(wantedRows)) problems.push(`the ${build} build had drawn ${JSON.stringify(run.drawn)}, not the ${String(SET.length)} forwards, when the rest began: a table that is not there costs nothing`);
    }

    if (committed.mounted === 0) problems.push('the development build counted no commit while the tool mounted, so that it counted none at rest says nothing');
    if (committed.commits !== 0) problems.push(`the development build committed ${String(committed.commits)} times (${String(committed.mutations)} changes of the document, ${String(committed.timeout + committed.interval)} timers)`);
    check('ports.idle', problems.length === 0, `${tag}: ${problems.join('; ')}`);
    note(`idle ${tag}: ${String(REST_MS)} ms at rest with ${String(SET.length)} forwards drawn: production ${JSON.stringify(made)}, development commits ${String(committed.commits)}`);
    report.numbers[`idle ${tag}`] = { made, committed };
  };

  // ports.hidden: the tool listens to the host only while it is on screen: before it was ever shown, with the panel open on another tool, with the panel hidden and after the person went to another tool, the host was asked for nothing and nothing of the
  // tool is listened to (every handler taken off: the counts of On and of its removals say so), and what the host says meanwhile is not read; shown again, it asks and listens again.
  sections.hidden = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      const state = async () => page.evaluate(() => ({ listed: window.__ports.reads.listed(), on: window.__ports.on(), off: window.__ports.off(), handlers: window.__ports.handlers(), names: window.__ports.names.listeners() }));
      const problems = [];
      const expectState = (name, got, want) => {
        for (const [key, value] of Object.entries(want)) if (got[key] !== value) problems.push(`${name}: ${key} is ${String(got[key])}, not ${String(value)}`);
      };

      expectState('before the tool was shown', await state(), { listed: 0, on: 0, handlers: 0, names: 0 });
      await page.evaluate(
        ({ sessions, names }) => {
          window.__ports.set(sessions);
          for (const [plugin, connection, name] of names) window.__ports.names.set(plugin, connection, name);
        },
        { sessions: SET, names: NAMES },
      );
      await page.click('[data-shell-part="panelToggle"]');
      await waitFor(page, () => document.querySelector('[data-shell-part="panelTools"]') !== null, null, 6000);
      await frames(page, 3);
      expectState('with the panel open on another tool', await state(), { listed: 0, on: 0, handlers: 0, names: 0 });
      await page.getByRole('tab', { name: 'Ports' }).click();
      await waitFor(page, (count) => window.__t.ids().length === count, SET.length, 8000);
      expectState('with the tool on screen', await state(), { listed: 1, on: 5, off: 0, handlers: 5, names: 1 });
      await page.click('[data-shell-part="panelToggle"]');
      await waitFor(page, () => window.__ports.handlers() === 0, null, 3000);
      await frames(page, 3);
      expectState('with the panel hidden', await state(), { listed: 1, on: 5, off: 5, handlers: 0, names: 0 });
      // What the host says while nobody looks is not read: no handler is there for it, and the list is not asked for. The list the host answers with changes meanwhile (the forward `api` is gone and another, `late`, is there: as many forwards as before),
      // and the tool, shown again, draws that one.
      const meanwhile = SET.map((entry) => (entry.id === 'api' ? { ...entry, id: 'late' } : entry));
      await page.evaluate(
        ({ session, list }) => {
          window.__ports.set(list);
          window.__ports.emit('core/networker/portforward/created', { ...session, id: 'late' });
          window.__ports.emit('core/networker/portforward/closed', session);
          window.__ports.emit('connection/status', {});
          window.__ports.emit('plugin/unloaded', { pluginID: 'acme', cause: 'crashed' });
        },
        { session: SET[0], list: meanwhile },
      );
      await frames(page, 3);
      expectState('after the host said things to a window that was not looking', await state(), { listed: 1, on: 5, off: 5, handlers: 0, names: 0 });
      await perturb(ctx, page, 'reopen');
      await page.click('[data-shell-part="panelToggle"]');
      const wantedIds = meanwhile.map((entry) => entry.id).sort();
      const refreshed = await waitFor(page, (want) => JSON.stringify([...window.__t.ids()].sort()) === JSON.stringify(want), wantedIds, 6000);
      if (!refreshed) problems.push(`shown again, the tool draws ${JSON.stringify(await page.evaluate(() => window.__t.ids()))}, not the forwards the host lists now (${JSON.stringify(wantedIds)}): the list it read was not drawn`);
      expectState('with the panel shown again', await state(), { listed: 2, on: 10, off: 5, handlers: 5, names: 1 });
      await page.getByRole('tab', { name: 'Terminal' }).click();
      await waitFor(page, () => window.__ports.handlers() === 0, null, 3000);
      await frames(page, 3);
      expectState('with another tool on screen', await state(), { listed: 2, on: 10, off: 10, handlers: 0, names: 0 });
      await page.getByRole('tab', { name: 'Ports' }).click();
      await waitFor(page, (count) => window.__t.ids().length === count, SET.length, 8000);
      expectState('with the tool chosen again', await state(), { listed: 3, on: 15, off: 10, handlers: 5, names: 1 });
      check('ports.hidden', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
    } finally {
      await page.context().close();
    }
  };

  // ports.flood: a flood of 500 forwards made and then 500 closed, each event in a task of its own as the runtime's socket delivers them, is drawn in a handful of commits and never more than two in a frame, and ends exact: the 510 rows, then the 10, and the count says so.
  sections.flood = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx, { dev: true });
    try {
      await reach(page);
      await frames(page, 3);
      // The development build's profiler has to be counting, or a flood drawn in no commit proves nothing: the tool has mounted, and mounting is a commit.
      const mounted = await page.evaluate(() => window.__commits.length);
      const template = { ...SET[0], created_at: at(30), connection: { ...SET[0].connection, resource_id: 'flood' }, local_port: 9000, remote_port: 9000 };
      const sample = async (name, total, expectRows) => {
        await page.evaluate(() => {
          // Each sample is its own: a callback of an earlier one that is still queued finds that another has taken its place and records nothing (it would add to the new sample's frames and start a second loop).
          const sample = { frames: 0, perFrame: [], on: true };
          window.__samples = sample;
          let last = window.__commits.length;
          const tick = () => {
            if (window.__samples !== sample) return;
            const now = window.__commits.length;
            sample.perFrame.push(now - last);
            sample.frames += 1;
            last = now;
            if (sample.on) window.__raf0(tick);
          };

          window.__raf0(tick);
        });
        const tasks = await page.evaluate(async ({ event, make, count }) => window.__ports.flood(event, 'f', count, make), { event: name, make: template, count: total });
        const settled = await waitFor(page, (rows) => window.__t.ids().length === rows, expectRows, 15_000);
        await frames(page, 4);
        const read = await page.evaluate(() => {
          window.__samples.on = false;
          return { ...window.__samples, count: window.__t.count()?.textContent ?? null, rows: window.__t.ids().length, ids: window.__t.ids() };
        });
        return { tasks, settled, ...read };
      };

      const problems = [];
      if (mounted === 0) problems.push('the development build counted no commit while the tool mounted, so that a flood is drawn in none says nothing');
      const made = await sample('core/networker/portforward/created', 500, SET.length + 500);
      const closed = await sample('core/networker/portforward/closed', 500, SET.length);
      for (const [name, run, rows] of [['500 forwards made', made, SET.length + 500], ['500 forwards closed', closed, SET.length]]) {
        const worst = Math.max(...run.perFrame);
        const commits = run.perFrame.reduce((sum, value) => sum + value, 0);
        if (run.tasks !== 500) problems.push(`${name}: the events came in ${String(run.tasks)} tasks, not 500`);
        // The rows are the ones expected at the end of each flood, before the next can change them: the forwards there were and the 500 made (in the order they were made), and then the forwards there were: a row of another id that took the place of one, or one that is repeated, keeps the count and not this.
        const wantIds = name === '500 forwards made' ? [...SET.map((entry) => entry.id), ...Array.from({ length: 500 }, (_, n) => `f${String(n)}`)] : SET.map((entry) => entry.id);
        if (JSON.stringify(run.ids) !== JSON.stringify(wantIds)) problems.push(`${name}: the rows are not the ones expected (${String(run.ids.length)} rows, ${String(run.ids.length - new Set(run.ids).size)} repeated, ${String(wantIds.filter((id) => !run.ids.includes(id)).length)} missing, ${String(run.ids.filter((id) => !wantIds.includes(id)).length)} not expected)`);
        if (!run.settled || run.rows !== rows) problems.push(`${name}: the table ends with ${String(run.rows)} rows, not ${String(rows)}`);
        if (run.count !== `${String(rows)} forwards`) problems.push(`${name}: the footer counts ${JSON.stringify(run.count)}, not ${String(rows)} forwards`);
        if (worst > 2) problems.push(`${name}: ${String(worst)} commits in one frame (the most is 2): ${JSON.stringify(run.perFrame.slice(0, 12))}`);
        if (commits > 50) problems.push(`${name}: ${String(commits)} commits for 500 events in ${String(run.frames)} frames`);
      }

      const final = await page.evaluate(() => window.__t.ids());
      if (JSON.stringify(final) !== JSON.stringify(SET.map((entry) => entry.id))) problems.push(`the rows that are left are ${JSON.stringify(final)}, not the ${String(SET.length)} that were there`);
      check('ports.flood', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
      note(`flood ${tag}: 500 made in ${String(made.frames)} frames, ${String(made.perFrame.reduce((sum, value) => sum + value, 0))} commits (most in a frame ${String(Math.max(...made.perFrame))}); 500 closed in ${String(closed.frames)} frames, ${String(closed.perFrame.reduce((sum, value) => sum + value, 0))} commits (most ${String(Math.max(...closed.perFrame))})`);
      report.numbers[`flood ${tag}`] = { made: made.perFrame, closed: closed.perFrame };
    } finally {
      await page.context().close();
    }
  };

  // ports.reconnect and ports.wake: the tool reads the list again when the page's events connection comes back after a gap (what the host did meanwhile was not told) and when the window comes back to a person (it gains the focus, or the page becomes
  // visible: the events cannot say everything), and listens to neither while it is not on screen. A read for each, and the rows are the host's.
  sections.events = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await reach(page);
      await frames(page, 3);
      const asked = async () => page.evaluate(() => window.__ports.reads.listed());
      const listening = async () => page.evaluate(() => ({ reconnect: window.__ports.reconnected.listeners(), wake: window.__ports.woken.listeners() }));
      const reconnect = [];
      const wake = [];
      // Shown, the connection comes back with the host's list changed (the forward `api` is gone and `late` is there: as many forwards as before): the rows are the host's, after one read.
      const meanwhile = SET.map((entry) => (entry.id === 'api' ? { ...entry, id: 'late' } : entry));
      const wantedIds = meanwhile.map((entry) => entry.id).sort();
      let before = await asked();
      await page.evaluate((list) => {
        window.__ports.set(list);
        window.__ports.reconnected.fire();
      }, meanwhile);
      const drawn = await waitFor(page, (want) => JSON.stringify([...window.__t.ids()].sort()) === JSON.stringify(want), wantedIds, 6000);
      await frames(page, 3);
      if (!drawn) reconnect.push(`after the events connection came back the tool draws ${JSON.stringify(await page.evaluate(() => window.__t.ids()))}, not what the host lists (${JSON.stringify(wantedIds)})`);
      const reads = (await asked()) - before;
      if (reads !== 1) reconnect.push(`the host was asked ${String(reads)} times for the list, not once`);
      const shown = await listening();
      if (shown.reconnect !== 1) reconnect.push(`${String(shown.reconnect)} listeners for the connection coming back while the tool is shown, not one`);
      if (shown.wake !== 1) wake.push(`${String(shown.wake)} listeners for the window coming back to a person while the tool is shown, not one`);
      // Shown, a focus is one read, a change of visibility is one, and three focuses in one task are at most two (the one that is on its way, and one that follows it).
      let current = meanwhile;
      for (const [what, kind, least, most] of [['a focus', 'focus', 1, 1], ['a change of visibility', 'visibility', 1, 1], ['three focuses in one task', 'three', 1, 2]]) {
        // Before each single event the host lists another set of the same size (its first forward takes another id), and the rows must become that set: a read whose answer is thrown away leaves the old ones. The burst is for the count alone.
        let wantedNow;
        if (kind !== 'three') {
          current = current.map((entry, index) => (index === 0 ? { ...entry, id: `wake-${kind}` } : entry));
          wantedNow = current.map((entry) => entry.id).sort();
          await page.evaluate((list) => {
            window.__ports.set(list);
          }, current);
        }

        before = await asked();
        await page.evaluate((how) => {
          if (how === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
          else for (let n = 0; n < (how === 'three' ? 3 : 1); n += 1) window.dispatchEvent(new Event('focus'));
        }, kind);
        await frames(page, 4);
        const made = (await asked()) - before;
        if (made < least || made > most) wake.push(`${what} made ${String(made)} reads of the list, not ${least === most ? String(least) : `${String(least)} to ${String(most)}`}`);
        if (wantedNow !== undefined) {
          const refreshed = await waitFor(page, (want) => JSON.stringify([...window.__t.ids()].sort()) === JSON.stringify(want), wantedNow, 4000);
          if (!refreshed) wake.push(`${what} was read and the tool draws ${JSON.stringify(await page.evaluate(() => window.__t.ids()))}, not what the host lists (${JSON.stringify(wantedNow)})`);
        }
      }

      // Hidden, nothing listens for either, and neither is read.
      await page.click('[data-shell-part="panelToggle"]');
      await waitFor(page, () => window.__ports.handlers() === 0, null, 4000);
      await frames(page, 3);
      const hidden = await listening();
      if (hidden.reconnect !== 0) reconnect.push(`${String(hidden.reconnect)} listeners for the connection coming back while the tool is hidden, not none`);
      if (hidden.wake !== 0) wake.push(`${String(hidden.wake)} listeners for the window coming back to a person while the tool is hidden, not none`);
      before = await asked();
      await page.evaluate(() => {
        window.__ports.reconnected.fire();
      });
      await frames(page, 4);
      const whileReconnecting = (await asked()) - before;
      if (whileReconnecting !== 0) reconnect.push(`the connection came back while the tool was hidden and the host was asked ${String(whileReconnecting)} times for the list`);
      before = await asked();
      await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await frames(page, 4);
      const whileWaking = (await asked()) - before;
      if (whileWaking !== 0) wake.push(`the window came back to a person while the tool was hidden and the host was asked ${String(whileWaking)} times for the list`);
      check('ports.reconnect', reconnect.length === 0, `${tag}: ${reconnect.slice(0, 5).join('; ')}`);
      check('ports.wake', wake.length === 0, `${tag}: ${wake.slice(0, 5).join('; ')}`);
    } finally {
      await page.context().close();
    }
  };

  // ports.confirm: Open in browser and Copy address ask the host for the list once more when they are pressed, and take what it says. Open acts only on a forward that the host says runs, at the address the host lists now, and says "Not opened: the
  // forward is not running." once for one that does not. Copy writes the address the table draws at the press, before the host answers, and does not write again: for a forward that does not run the row says so, its Open and Copy are unavailable, the copy
  // glyph does not become the check and "Copied, but the forward is not running." is said once; for one that runs "Address copied" is said once.
  sections.confirm = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await reach(page, { tall: true });
      await page.evaluate(() => {
        window.__t.watch();
      });
      const problems = [];
      const asked = async () => page.evaluate(() => window.__ports.reads.listed());
      const told = async () => page.evaluate(() => window.__t.told.slice());
      const host = async (list) =>
        page.evaluate((next) => {
          window.__ports.set(next);
        }, list);
      const changed = (id, patch) => SET.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
      /** The table draws what the host lists again (a connection event makes it read), so that the next press starts from rows that run. */
      const resync = async (id) => {
        await host(SET);
        await page.evaluate(() => {
          window.__ports.emit('connection/status', {});
        });
        await waitFor(page, (row) => window.__t.stateOf(row) === 'running', id, 6000);
      };

      const press = async (what, id, name, hasActed, acted) => {
        const reads = await asked();
        const calls = await callsOf(page);
        await buttonOf(page, id, name).click();
        await waitFor(page, hasActed, calls, 6000);
        await frames(page, 3);
        const now = await callsOf(page);
        const made = (await asked()) - reads;
        if (made !== 1) problems.push(`${what}: a press asked the host for the list ${String(made)} times, not once`);
        acted(calls, now);
      };

      // a. The host says the forward failed while the table still draws it running: Open does nothing and says so, and the row says what the host said.
      await host(changed('api', { state: 'FAILED' }));
      await press('a forward the host says failed, Open in browser', 'api', 'Open in browser', () => window.__t.told.length >= 1, (calls, now) => {
        if (now.opened.length !== calls.opened.length) problems.push(`Open in browser opened ${JSON.stringify(now.opened.slice(calls.opened.length))} for a forward the host says failed`);
      });
      const word = await page.evaluate(() => window.__t.readRow(window.__t.row('api')).status?.word ?? null);
      if (word !== 'Failed') problems.push(`the row of the forward the host says failed says ${JSON.stringify(word)}`);
      // b. Copy address of another forward that the host says failed. The address the table draws is on the clipboard at the press, before the host answers (the probe holds the read to see it); then the row says what the host said, its Open in browser and
      // Copy address are unavailable for the reason and its Stop is not, the copy glyph does not become the check, and the live region says "Copied, but the forward is not running." once.
      await resync('api');
      await host(changed('payments', { state: 'FAILED' }));
      await page.evaluate(() => {
        window.__ports.reads.mode = 'hold';
      });
      const readsB = await asked();
      const callsB = await callsOf(page);
      await buttonOf(page, 'payments', 'Copy address').click();
      const waiting = await page.evaluate(() => ({ held: window.__ports.reads.held(), writes: window.__clip.writes.slice() }));
      if (JSON.stringify(waiting.writes.slice(callsB.copied.length)) !== JSON.stringify(['127.0.0.1:8100'])) problems.push(`before the host answered the clipboard was given ${JSON.stringify(waiting.writes.slice(callsB.copied.length))}, not the address the table draws (127.0.0.1:8100)`);
      if (waiting.held !== 1) problems.push(`the press waited on ${String(waiting.held)} reads of the host, not one`);
      await page.evaluate(() => {
        window.__ports.reads.mode = 'ok';
        window.__ports.reads.answer();
      });
      await waitFor(page, () => window.__t.told.length >= 2, null, 6000);
      await frames(page, 30);
      const failed = await page.evaluate(() => {
        const row = window.__t.readRow(window.__t.row('payments'));
        return {
          word: row.status?.word ?? null,
          buttons: row.buttons.map((button) => ({ action: button.action, disabled: button.disabled, native: button.native, description: button.description, glyph: button.glyph })),
          told: window.__t.told.slice(),
          live: window.__t.live(),
          writes: window.__clip.writes.slice(),
        };
      });
      if (failed.word !== 'Failed') problems.push(`the row of the forward the host says failed says ${JSON.stringify(failed.word)} after Copy address`);
      for (const action of ['open', 'copy']) {
        const button = failed.buttons.find((entry) => entry.action === action);
        if (button?.disabled !== true || button.native !== false || button.description !== NOT_RUNNING) problems.push(`${action} of the forward the host says failed is ${JSON.stringify(button)}, not unavailable for ${JSON.stringify(NOT_RUNNING)}`);
      }

      if (failed.buttons.find((entry) => entry.action === 'stop')?.disabled !== false) problems.push('Stop of the forward the host says failed is unavailable');
      if (failed.buttons.find((entry) => entry.action === 'copy')?.glyph !== 'copy') problems.push(`the copy button draws ${JSON.stringify(failed.buttons.find((entry) => entry.action === 'copy')?.glyph)} for a copy of a forward that does not run, not the copy glyph`);
      if (JSON.stringify(failed.told) !== JSON.stringify(['Not opened: the forward is not running.', 'Copied, but the forward is not running.'])) problems.push(`the live region was told ${JSON.stringify(failed.told)} for Open in browser and Copy address on forwards that failed`);
      if (failed.live !== 'Copied, but the forward is not running.') problems.push(`the live region holds ${JSON.stringify(failed.live)} after Copy address on a forward that failed`);
      if (JSON.stringify(failed.writes.slice(callsB.copied.length)) !== JSON.stringify(['127.0.0.1:8100'])) problems.push(`the clipboard was given ${JSON.stringify(failed.writes.slice(callsB.copied.length))} in all for Copy address on a forward that failed, the address the table draws once`);
      if ((await asked()) - readsB !== 1) problems.push(`Copy address on a forward that failed asked the host for the list ${String((await asked()) - readsB)} times, not once`);
      // c. The host says the forward runs, at another address than the table draws: Open acts once, at the host's.
      await resync('payments');
      await host(changed('api', { local_port: 8091 }));
      await press('a forward that runs, Open in browser', 'api', 'Open in browser', (before) => window.__ports.opened.length > before.opened.length, (calls, now) => {
        if (JSON.stringify(now.opened.slice(calls.opened.length)) !== JSON.stringify(['http://127.0.0.1:8091'])) problems.push(`Open in browser opened ${JSON.stringify(now.opened.slice(calls.opened.length))}, once at the address the host lists now (http://127.0.0.1:8091) was to be`);
      });
      // d. Copy address of a forward that runs, the host listing another address than the table draws: the address the table draws is written at the press and is not written again when the host answers with the other, and "Address copied" is said once (the row is marked only while it has the address that was copied, which it has not here).
      await host(changed('api', { local_port: 8092 }));
      const readsD = await asked();
      const callsD = await callsOf(page);
      await buttonOf(page, 'api', 'Copy address').click();
      await waitFor(page, () => window.__t.told.length >= 3, null, 6000);
      await frames(page, 4);
      const copied = await page.evaluate(() => ({ writes: window.__clip.writes.slice() }));
      if (JSON.stringify(copied.writes.slice(callsD.copied.length)) !== JSON.stringify(['127.0.0.1:8091'])) problems.push(`Copy address wrote ${JSON.stringify(copied.writes.slice(callsD.copied.length))}, once the address the table drew (127.0.0.1:8091) was to be, and not again at the host's (127.0.0.1:8092)`);
      if ((await asked()) - readsD !== 1) problems.push(`Copy address on a forward that runs asked the host for the list ${String((await asked()) - readsD)} times, not once`);
      const all = await told();
      if (JSON.stringify(all) !== JSON.stringify(['Not opened: the forward is not running.', 'Copied, but the forward is not running.', 'Address copied'])) problems.push(`the live region was told ${JSON.stringify(all)} in all`);
      check('ports.confirm', problems.length === 0, `${tag}: ${problems.slice(0, 5).join('; ')}`);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ hosts
  /**
   * One forward for each way a producer may state where a forward listens, or not state it. The SDK's reader keeps `localhost` in any case or a strict IP address as written (an IPv6 one may carry a zone) and reads anything else as none, and the tool says
   * what it is told and makes none up. The classes: LOOPBACK (`localhost`, 127.0.0.0/8, `::1`, `::ffff:127.x.y.z` in any form: Mapping with the host as stated, Open in browser at the host a browser here reaches it by, Copy address), EVERYWHERE (0.0.0.0, `::`,
   * `::ffff:0.0.0.0`) and ELSEWHERE (any other address): Mapping with the host as stated, Open in browser unavailable, Copy port, and for a RUNNING forward a second line that says that other computers may reach it; UNSTATED (none, or text that is not an address):
   * `port <port> → …`, Open in browser unavailable, Copy port. `open` is the address Open in browser is made to open, `openOff` why it is unavailable, `udp` that it is not offered, `copyOff` why Copy is unavailable, `endpoint` what Copy writes (and `copy` what it is
   * called, `says` what it says), `line` the second line of the row and `menu` that the row's menu is looked at. The words are the tool's own: the mock's forwards all say `127.0.0.1`. The forwards are drawn in four pages (a row with a second line is taller, and
   * a table that scrolls puts a menu away).
   */
  const LOOP = { copy: 'Copy address', says: 'Address copied' };
  const PORT = { copy: 'Copy port', says: 'Port copied' };
  const HOST_GROUPS = [
    // On this computer in every form, and not stated.
    [
      { id: 'h-none', patch: { local_port: 8081 }, mapping: 'port 8081 → :8080/TCP', ...PORT, openOff: OPEN_UNSTATED, endpoint: '8081', menu: true },
      { id: 'h-v4', patch: { local_host: '127.0.0.1', local_port: 8082 }, mapping: '127.0.0.1:8082 → :8080/TCP', ...LOOP, open: 'http://127.0.0.1:8082', endpoint: '127.0.0.1:8082', menu: true },
      { id: 'h-v4b', patch: { local_host: '127.0.0.2', local_port: 8083 }, mapping: '127.0.0.2:8083 → :8080/TCP', ...LOOP, open: 'http://127.0.0.2:8083', endpoint: '127.0.0.2:8083' },
      { id: 'h-name', patch: { local_host: 'localhost', local_port: 8084 }, mapping: 'localhost:8084 → :8080/TCP', ...LOOP, open: 'http://localhost:8084', endpoint: 'localhost:8084' },
      { id: 'h-nameup', patch: { local_host: 'LOCALHOST', local_port: 8085 }, mapping: 'LOCALHOST:8085 → :8080/TCP', ...LOOP, open: 'http://localhost:8085', endpoint: 'LOCALHOST:8085' },
      { id: 'h-v6', patch: { local_host: '::1', local_port: 8086 }, mapping: '[::1]:8086 → :8080/TCP', ...LOOP, open: 'http://[::1]:8086', endpoint: '[::1]:8086' },
      { id: 'h-v6zone', patch: { local_host: '::1%lo', local_port: 8087 }, mapping: '[::1%lo]:8087 → :8080/TCP', ...LOOP, open: 'http://[::1]:8087', endpoint: '[::1%lo]:8087' },
      { id: 'h-map', patch: { local_host: '::ffff:127.0.0.1', local_port: 8088 }, mapping: '[::ffff:127.0.0.1]:8088 → :8080/TCP', ...LOOP, open: 'http://127.0.0.1:8088', endpoint: '[::ffff:127.0.0.1]:8088' },
      { id: 'h-maphex', patch: { local_host: '::ffff:7f00:1', local_port: 8089 }, mapping: '[::ffff:7f00:1]:8089 → :8080/TCP', ...LOOP, open: 'http://127.0.0.1:8089', endpoint: '[::ffff:7f00:1]:8089' },
    ],
    // Text that is not an address is not a host; and UDP, where Open in browser is never offered.
    [
      { id: 'h-bad1', patch: { local_host: '127.0.0.1:8080', local_port: 8091 }, mapping: 'port 8091 → :8080/TCP', ...PORT, openOff: OPEN_UNSTATED, endpoint: '8091' },
      { id: 'h-bad2', patch: { local_host: '[::1]', local_port: 8092 }, mapping: 'port 8092 → :8080/TCP', ...PORT, openOff: OPEN_UNSTATED, endpoint: '8092' },
      { id: 'h-bad3', patch: { local_host: 'localhost.', local_port: 8093 }, mapping: 'port 8093 → :8080/TCP', ...PORT, openOff: OPEN_UNSTATED, endpoint: '8093' },
      { id: 'h-bad4', patch: { local_host: ' 127.0.0.1', local_port: 8094 }, mapping: 'port 8094 → :8080/TCP', ...PORT, openOff: OPEN_UNSTATED, endpoint: '8094' },
      { id: 'h-udp', patch: { protocol: 'UDP', local_port: 5353, remote_port: 53 }, mapping: 'port 5353 → :53/UDP', ...PORT, udp: true, endpoint: '5353' },
      { id: 'h-udp4', patch: { protocol: 'UDP', local_host: '127.0.0.1', local_port: 5354, remote_port: 53 }, mapping: '127.0.0.1:5354 → :53/UDP', ...LOOP, udp: true, endpoint: '127.0.0.1:5354', menu: true },
    ],
    // Other computers may reach them: every interface, and any other address. A running one says so.
    [
      { id: 'h-all', patch: { local_host: '0.0.0.0', local_port: 8101 }, mapping: '0.0.0.0:8101 → :8080/TCP', ...PORT, openOff: OPEN_BEYOND, endpoint: '8101', line: EVERYWHERE, menu: true },
      { id: 'h-all6', patch: { local_host: '::', local_port: 8102 }, mapping: '[::]:8102 → :8080/TCP', ...PORT, openOff: OPEN_BEYOND, endpoint: '8102', line: EVERYWHERE },
      { id: 'h-allmap', patch: { local_host: '::ffff:0.0.0.0', local_port: 8103 }, mapping: '[::ffff:0.0.0.0]:8103 → :8080/TCP', ...PORT, openOff: OPEN_BEYOND, endpoint: '8103', line: EVERYWHERE },
      { id: 'h-lan', patch: { local_host: '192.168.1.5', local_port: 8104 }, mapping: '192.168.1.5:8104 → :8080/TCP', ...PORT, openOff: OPEN_BEYOND, endpoint: '8104', line: ELSEWHERE('192.168.1.5'), menu: true },
      { id: 'h-ll', patch: { local_host: 'fe80::1%en0', local_port: 8105 }, mapping: '[fe80::1%en0]:8105 → :8080/TCP', ...PORT, openOff: OPEN_BEYOND, endpoint: '8105', line: ELSEWHERE('fe80::1%en0') },
      { id: 'h-udpall', patch: { protocol: 'UDP', local_host: '0.0.0.0', local_port: 5355, remote_port: 53 }, mapping: '0.0.0.0:5355 → :53/UDP', ...PORT, udp: true, endpoint: '5355', line: EVERYWHERE, menu: true },
      { id: 'h-autoall', patch: { local_host: '0.0.0.0', local_port: 0 }, mapping: 'Auto → :8080/TCP', ...PORT, openOff: OPEN_BEYOND, copyOff: NO_PORT, line: EVERYWHERE },
    ],
    // No port yet, or not running: nothing is said of who may reach them.
    [
      { id: 'h-auto', patch: { local_port: 0 }, mapping: 'Auto → :8080/TCP', ...PORT, openOff: OPEN_UNSTATED, copyOff: NO_PORT },
      { id: 'h-auto4', patch: { local_host: '127.0.0.1', local_port: 0 }, mapping: 'Auto → :8080/TCP', ...LOOP, openOff: NO_PORT, copyOff: NO_PORT },
      { id: 'h-fail4', patch: { state: 'FAILED', local_host: '127.0.0.1', local_port: 8111 }, mapping: '127.0.0.1:8111 → :8080/TCP', ...LOOP, openOff: NOT_RUNNING, copyOff: NOT_RUNNING },
      { id: 'h-failn', patch: { state: 'FAILED', local_port: 8112 }, mapping: 'port 8112 → :8080/TCP', ...PORT, openOff: OPEN_UNSTATED, copyOff: NOT_RUNNING, menu: true },
      { id: 'h-failb', patch: { state: 'FAILED', local_host: '0.0.0.0', local_port: 8113 }, mapping: '0.0.0.0:8113 → :8080/TCP', ...PORT, openOff: OPEN_BEYOND, copyOff: NOT_RUNNING },
      { id: 'h-stopb', patch: { state: 'STOPPED', local_host: '0.0.0.0', local_port: 8114 }, mapping: '0.0.0.0:8114 → :8080/TCP', ...PORT, openOff: OPEN_BEYOND, copyOff: NOT_RUNNING },
      { id: 'h-pausel', patch: { state: 'PAUSED', local_host: '192.168.1.5', local_port: 8115 }, mapping: '192.168.1.5:8115 → :8080/TCP', ...PORT, openOff: OPEN_BEYOND, copyOff: NOT_RUNNING },
    ],
  ];
  const hostList = (cases) => cases.map((entry, index) => forward(entry.id, entry.id, index + 1, entry.patch));

  // ports.hosts: what the producer states of where a forward listens is what the row says, and nothing else: the Mapping (`port <port> → …` while no host is stated or the text is not an address, `<host>:<port> → …` with the host as stated when one is, an IPv6 host in
  // brackets, `Auto → …` while the port is not assigned), the name of the row's group, and the name and the tip of Copy (Copy address for a forward on this computer, Copy port for every other). ports.exposed: a RUNNING forward that other computers may reach says so on a
  // second line (that it listens on every network interface, or on the address as stated), in the mock's second-line size and colour and in the mock's two-line row, and every other row has none and is the mock's 24 px. The mock's five forwards with no host stated are read as
  // well, and how they differ from the mock is recorded: the Mapping, Open in browser and Copy are the tool's own words, and the Connection column is the mock's.
  sections.hosts = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const mock = reference()?.data?.[engine]?.[vp]?.table;
    const words = [];
    const exposures = [];
    const plain = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
    const toolOf = (row, action) => row?.buttons.find((button) => button.action === action);
    const second = mock?.rows[MOCK_ROWS.proxy];
    const measured = new Map();
    const round2 = (value) => Math.round(value * 100) / 100;
    for (const cases of HOST_GROUPS) {
      const page = await openPage(ctx);
      try {
        await reach(page, { sessions: hostList(cases), tall: true });
        await perturb(ctx, page, 'ready');
        const read = await page.evaluate(() => window.__t.read());
        for (const entry of cases) {
          const row = rowOf(read, entry.id);
          if (row === undefined) {
            words.push(`${entry.id} is not in the table`);
            continue;
          }

          if (row.resource.reason !== null && row.resource.reason !== undefined) measured.set(entry.id, { row, line: row.resource.reason });

          if (row.mapping.text !== entry.mapping) words.push(`${entry.id} says ${JSON.stringify(row.mapping.text)}, not ${JSON.stringify(entry.mapping)}`);
          if (row.group?.label !== `Port actions for ${entry.id}, ${entry.mapping}`) words.push(`the group of ${entry.id} is named ${JSON.stringify(row.group?.label)}`);
          const copy = toolOf(row, 'copy');
          if (copy?.label !== entry.copy) words.push(`Copy of ${entry.id} is named ${JSON.stringify(copy?.label)}, not ${entry.copy}`);
          const tip = entry.copyOff === undefined ? entry.copy : `${entry.copy} ${entry.copyOff}`;
          if (plain(copy?.tip) !== tip) words.push(`the tip of Copy of ${entry.id} says ${JSON.stringify(plain(copy?.tip))}, not ${JSON.stringify(tip)}`);
          if (entry.copyOff === undefined && copy?.disabled !== false) words.push(`Copy of ${entry.id} is unavailable, and it can be used`);
          if (entry.copyOff !== undefined && (copy?.disabled !== true || copy.native || copy.description !== entry.copyOff)) words.push(`Copy of ${entry.id} is ${JSON.stringify({ disabled: copy?.disabled, native: copy?.native, description: copy?.description })}, not unavailable for ${JSON.stringify(entry.copyOff)}`);
          const line = row.resource.reason;
          if ((line?.text ?? null) !== (entry.line ?? null)) exposures.push(`${entry.id} says ${JSON.stringify(line?.text ?? null)} on a second line, not ${JSON.stringify(entry.line ?? null)}`);
          if (entry.line === undefined) {
            if (!near(row.rect?.[3], 24)) exposures.push(`${entry.id}, with no second line, is ${String(row.rect?.[3])} px high, not the mock's 24`);
          } else if (second === undefined || second.resource.sub === null) exposures.push('the mock is not measured (run mock-ports-measure.mjs)');
          else if (line !== null && line !== undefined) exposures.push(...secondLineProblems(row, line, second).map((problem) => `${entry.id}: ${problem}`));
        }
      } finally {
        await page.context().close();
      }
    }

    // The two-line row of a forward that others may reach, measured against the mock's two-line row (a note: ports.exposed holds that they are the same).
    const sample = measured.get('h-all');
    if (sample !== undefined && second !== undefined && second.resource.sub !== null) note(`exposed second line ${tag}: the row is ${String(sample.row.rect?.[3])} px (the mock's two-line row ${String(second.rect[3])}), its line starts ${String(round2(sample.line.rect[0] - (sample.row.cells[0].rect?.[0] ?? 0)))} px in and ${String(round2(sample.line.rect[1] - (sample.row.rect?.[1] ?? 0)))} px down (the mock's ${String(round2(second.resource.sub.rect[0] - second.cells[0].rect[0]))} and ${String(round2(second.resource.sub.rect[1] - second.rect[1]))}), set in ${sample.line.style['font-size']}/${sample.line.style['line-height']} ${sample.line.style.color} (the mock's ${second.resource.sub.style['font-size']}/${second.resource.sub.style['line-height']} ${second.resource.sub.style.color})`);
    // The mock's five forwards with no host stated: the Mapping, Open in browser and Copy are the tool's own words (recorded), the Connection column is the mock's.
    const plainFive = NAMED_FIVE.map((entry) => ({ ...entry, local_host: undefined }));
    const last = await openPage(ctx);
    try {
      await reach(last, { sessions: plainFive, tall: true });
      const five = await last.evaluate(() => window.__t.read());
      const recorded = [];
      for (const [id, index] of Object.entries(MOCK_ROWS)) {
        const row = rowOf(five, id);
        const them = mock?.rows[index];
        if (them === undefined) {
          words.push('the mock is not measured (run mock-ports-measure.mjs)');
          break;
        }

        if (row?.connection.text !== them.connection.text) words.push(`the Connection of ${id} reads ${JSON.stringify(row?.connection.text)} with no host stated, the mock's is ${JSON.stringify(them.connection.text)}`);
        recorded.push({ id, mapping: { tool: row?.mapping.text, mock: them.mapping.text }, open: { tool: toolOf(row, 'open')?.disabled === true ? `unavailable: ${String(toolOf(row, 'open')?.description)}` : 'available', mock: 'available' }, copy: { tool: toolOf(row, 'copy')?.label, mock: 'Copy address' } });
      }

      for (const line of recorded) note(`recorded difference from the mock ${tag}: ${line.id}: Mapping ${JSON.stringify(line.mapping.tool)} (the mock's ${JSON.stringify(line.mapping.mock)}), Open in browser ${line.open.tool} (the mock's: ${line.open.mock}), ${String(line.copy.tool)} (the mock's: ${line.copy.mock})`);
      report.numbers[`hosts differences ${tag}`] = recorded;
    } finally {
      await last.context().close();
    }

    check('ports.hosts', words.length === 0, `${tag}: ${words.slice(0, 5).join('; ')}`);
    check('ports.exposed', exposures.length === 0, `${tag}: ${exposures.slice(0, 5).join('; ')}`);
  };

  // ports.reach: Open in browser is offered only for a forward that listens on this computer: unavailable, for the reason, where no host is stated (or the text is not an address) and where the forward listens beyond this computer (as is its menu item), not offered over UDP; pressed
  // where it is unavailable it asks the host nothing and opens nothing; where it is available it reads the list once and opens `http://<host>:<port>` at the host a browser here reaches it by (the IPv4 address as stated, a mapped one unmapped, `[::1]`, `localhost`, no zone).
  // ports.endpoint: Copy writes inside the press, once, and says so once: the host and the port as stated for a forward on this computer ("Address copied"), the port alone for every other ("Port copied"); where it is unavailable it writes nothing and asks nothing.
  sections.reaches = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const reaches = [];
    const endpoints = [];
    const plain = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
    const toolOf = (row, action) => row?.buttons.find((button) => button.action === action);
    for (const cases of HOST_GROUPS) {
      const page = await openPage(ctx);
      try {
        await page.evaluate(() => {
          window.__t.watch();
        });
        await reach(page, { sessions: hostList(cases), tall: true });
        await perturb(ctx, page, 'ready');
        const read = await page.evaluate(() => window.__t.read());
        const asked = async () => page.evaluate(() => window.__ports.reads.listed());
        // Open in browser, by the buttons.
        for (const entry of cases) {
          const open = toolOf(rowOf(read, entry.id), 'open');
          if (entry.udp === true) {
            if (open !== undefined) reaches.push(`${entry.id}, over UDP, is offered Open in browser`);
          } else if (open === undefined) reaches.push(`${entry.id} has no Open in browser`);
          else if (entry.open !== undefined) {
            if (open.disabled) reaches.push(`Open in browser of ${entry.id} is unavailable (${JSON.stringify(open.description)}), and it can be used`);
          } else {
            if (open.disabled !== true || open.native) reaches.push(`Open in browser of ${entry.id} is ${JSON.stringify({ disabled: open.disabled, native: open.native })}, not unavailable`);
            if (open.description !== entry.openOff) reaches.push(`Open in browser of ${entry.id} is described by ${JSON.stringify(open.description)}, not ${JSON.stringify(entry.openOff)}`);
            if (plain(open.tip) !== `Open in browser ${entry.openOff}`) reaches.push(`the tip of Open in browser of ${entry.id} says ${JSON.stringify(plain(open.tip))}, not ${JSON.stringify(`Open in browser ${entry.openOff}`)}`);
          }
        }

        // Pressed where it is unavailable, Open in browser asks the host for nothing and opens nothing.
        const beforeOff = { reads: await asked(), calls: await callsOf(page) };
        for (const entry of cases.filter((candidate) => candidate.openOff !== undefined)) await press(reaches, buttonOf(page, entry.id, 'Open in browser'), `Open in browser of ${entry.id}`);
        await frames(page, 3);
        const afterOff = { reads: await asked(), calls: await callsOf(page) };
        if (afterOff.reads !== beforeOff.reads) reaches.push(`pressing Open in browser where it is unavailable asked the host for the list ${String(afterOff.reads - beforeOff.reads)} times`);
        if (JSON.stringify(afterOff.calls.opened) !== JSON.stringify(beforeOff.calls.opened)) reaches.push(`pressing Open in browser where it is unavailable opened ${JSON.stringify(afterOff.calls.opened.slice(beforeOff.calls.opened.length))}`);
        // Where it is available it reads the list once and opens the host a browser here reaches it by, and the port.
        for (const entry of cases.filter((candidate) => candidate.open !== undefined)) {
          const reads = await asked();
          const calls = await callsOf(page);
          await buttonOf(page, entry.id, 'Open in browser').click();
          await waitFor(page, (length) => window.__ports.opened.length > length, calls.opened.length, 6000);
          await frames(page, 3);
          const now = await callsOf(page);
          if (JSON.stringify(now.opened.slice(calls.opened.length)) !== JSON.stringify([entry.open])) reaches.push(`Open in browser of ${entry.id} opened ${JSON.stringify(now.opened.slice(calls.opened.length))}, not ${JSON.stringify([entry.open])}`);
          if ((await asked()) - reads !== 1) reaches.push(`Open in browser of ${entry.id} asked the host for the list ${String((await asked()) - reads)} times, not once`);
        }

        // Its menu item says the same.
        for (const entry of cases.filter((candidate) => candidate.menu === true)) {
          const items = entry.udp === true ? ['Stop', entry.copy] : ['Stop', 'Open in browser', entry.copy];
          const menu = await openByPointer(page, entry.id);
          if (menu === null) reaches.push(`no menu opened on ${entry.id}`);
          else {
            if (JSON.stringify(menu.items.map((item) => item.label)) !== JSON.stringify(items)) reaches.push(`the menu of ${entry.id} has the items ${JSON.stringify(menu.items.map((item) => item.label))}, not ${JSON.stringify(items)}`);
            const open = menu.items.find((item) => item.label === 'Open in browser');
            if (entry.udp !== true && entry.openOff === undefined && open?.disabled === true) reaches.push(`the item Open in browser of ${entry.id} is unavailable, and it can be used`);
            if (entry.udp !== true && entry.openOff !== undefined && (open?.disabled !== true || open.description !== entry.openOff)) reaches.push(`the item Open in browser of ${entry.id} is ${JSON.stringify({ disabled: open?.disabled, description: open?.description })}, not unavailable for ${JSON.stringify(entry.openOff)}`);
          }

          await page.keyboard.press('Escape');
          await menuShown(page, false);
          await frames(page, 3);
        }

        // Copy writes inside the press, once, and says so once.
        let toldBefore = 0;
        for (const entry of cases.filter((candidate) => candidate.endpoint !== undefined)) {
          const calls = await callsOf(page);
          const reads = await asked();
          await buttonOf(page, entry.id, 'Copy address').click();
          const written = (await callsOf(page)).copied.slice(calls.copied.length);
          if (JSON.stringify(written) !== JSON.stringify([entry.endpoint])) endpoints.push(`Copy of ${entry.id} wrote ${JSON.stringify(written)} inside the press, not ${JSON.stringify([entry.endpoint])}`);
          await waitFor(page, (length) => window.__t.told.length > length, toldBefore, 6000);
          await frames(page, 3);
          const said = await page.evaluate(() => window.__t.told.slice());
          if (JSON.stringify(said.slice(toldBefore)) !== JSON.stringify([entry.says])) endpoints.push(`Copy of ${entry.id} said ${JSON.stringify(said.slice(toldBefore))}, not ${entry.says} once`);
          toldBefore = said.length;
          if ((await callsOf(page)).copied.length - calls.copied.length !== 1) endpoints.push(`Copy of ${entry.id} wrote ${String((await callsOf(page)).copied.length - calls.copied.length)} times, not once`);
          if ((await asked()) - reads !== 1) endpoints.push(`Copy of ${entry.id} asked the host for the list ${String((await asked()) - reads)} times, not once`);
        }

        // Where Copy is unavailable it writes nothing and asks nothing.
        const beforeCopy = { reads: await asked(), calls: await callsOf(page) };
        for (const entry of cases.filter((candidate) => candidate.copyOff !== undefined)) await press(endpoints, buttonOf(page, entry.id, 'Copy address'), `Copy of ${entry.id}`);
        await frames(page, 3);
        const afterCopy = { reads: await asked(), calls: await callsOf(page) };
        if (afterCopy.reads !== beforeCopy.reads) endpoints.push(`pressing Copy where it is unavailable asked the host for the list ${String(afterCopy.reads - beforeCopy.reads)} times`);
        if (JSON.stringify(afterCopy.calls.copied) !== JSON.stringify(beforeCopy.calls.copied)) endpoints.push(`pressing Copy where it is unavailable wrote ${JSON.stringify(afterCopy.calls.copied.slice(beforeCopy.calls.copied.length))}`);
      } finally {
        await page.context().close();
      }
    }

    check('ports.reach', reaches.length === 0, `${tag}: ${reaches.slice(0, 5).join('; ')}`);
    check('ports.endpoint', endpoints.length === 0, `${tag}: ${endpoints.slice(0, 5).join('; ')}`);
  };

  // ------------------------------------------------------------------------------------------------ axe
  const markAxe = async (page, name, selector) => {
    await page.addScriptTag({ path: axe });
    await page.evaluate(({ id, target }) => {
      document.querySelector(target)?.setAttribute('data-probe-axe', id);
    }, { id: name, target: selector });
  };

  // axe.table: axe-core finds nothing in the table with a forward in every state, with a row's menu closed.
  sections['axe-table'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await reach(page);
      await perturb(ctx, page, 'staging');
      const unstaged = await stage(page);
      if (unstaged.length > 0) {
        check('axe.table', false, `${tag}: the table was not staged, so it was not scanned: ${unstaged.join('; ')}`);
        return;
      }

      await markAxe(page, 'table', '[data-shell-part="portsBody"]');
      await perturb(ctx, page, 'axe');
      // The states are read again after the perturbation, before the scan: a table that is no longer the staged one is not the table this check says it covers.
      const still = await page.evaluate(() => ({ worker: window.__t.stateOf('worker'), queue: window.__t.stateOf('queue') }));
      if (still.worker !== 'stopping' || still.queue !== 'stopped') {
        check('axe.table', false, `${tag}: the worker is ${JSON.stringify(still.worker)} and the queue ${JSON.stringify(still.queue)} when the table is to be scanned, not stopping and stopped: it was not scanned`);
        return;
      }

      const found = await runAxe(page, '[data-probe-axe="table"]');
      check('axe.table', found.length === 0, `${tag}: the table of ${String(SET.length)} forwards in every state: ${JSON.stringify(found)}`);
    } finally {
      await page.context().close();
    }
  };

  // axe.states: axe-core finds nothing in the tool while it loads, when the host could not be read and when it holds no forward.
  sections['axe-states'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const found = [];
    for (const [name, query, sessions, status] of [['loading', 'read=hold', SET, 'loading'], ['failed', 'read=fail&fails=1', SET, 'failed'], ['empty', '', [], 'ready']]) {
      const page = await openPage(ctx, { query });
      try {
        await reach(page, { sessions, rows: false });
        const reached = await waitFor(page, (want) => window.__t.body()?.dataset.portsStatus === want, status, 8000);
        if (!reached) {
          found.push(`${name}: the tool is in the state ${JSON.stringify(await page.evaluate(() => window.__t.body()?.dataset.portsStatus ?? null))}, not ${JSON.stringify(status)}: it was not scanned`);
          continue;
        }

        await markAxe(page, 'states', '[data-shell-part="portsBody"]');
        await perturb(ctx, page, 'axe');
        for (const line of await runAxe(page, '[data-probe-axe="states"]')) found.push(`${name}: ${line}`);
      } finally {
        await page.context().close();
      }
    }

    check('axe.states', found.length === 0, `${tag}: loading, failed and empty: ${JSON.stringify(found)}`);
  };

  // axe.menu: axe-core finds nothing in the open row menu.
  sections['axe-menu'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await reach(page, { tall: true });
      const menu = await openByPointer(page, 'api');
      if (menu === null) {
        check('axe.menu', false, `${tag}: the menu of the row did not open, so it was not scanned`);
        return;
      }

      await markAxe(page, 'menu', '[role="menu"]');
      await perturb(ctx, page, 'axe');
      const found = await runAxe(page, '[data-probe-axe="menu"]');
      check('axe.menu', found.length === 0, `${tag}: the open menu of a row: ${JSON.stringify(found)}`);
    } finally {
      await page.context().close();
    }
  };

  return sections;
}
