// The host's Problems and Operations tools in the real panel, over the real models, for the probe (problems-operations-probe.mjs): the shell's frame and panel (`StaticShell` over `staticPanel`: the panel model, the tool strip with
// the badges, the body slot and the status bar are the product's), the two bodies as the host draws them (`ProblemsBody`, `OperationsBody`, each handed `renderTool`'s answer for its tool), the models (`createProblems`,
// `createOperations` over `createActivityFeed`) and the tab badges' source (`badgesOf`, the host's own). What is invented is only what comes IN: the conditions and the activity records the probe builds by hand, the names the
// window knows for plugins and connections, and the function that opens a row's subject (it records the call: the host's own goes to the tab model). A second HTML entry that the probe builds on its own; `vite build` of the
// channel never reaches it.
//
//   ?tool=problems   the tool on screen at the start: problems (default), operations, terminal or logs (the last two are tools with no sessions, so the panel says so: they stand for "another tool")
//   ?open=1          whether the panel is open at the start (default 1); `0` is a hidden panel
//   ?read=hold       what the host's `markRead` does: `hold` (default) records the call and leaves the record as it was, so a dot stays; `apply` is the host's: the record comes back read
//   ?control=...     the probe's perturbations, each the fault one of its assertions is there to see (the others are made in the loaded page, by the probe, as stylesheets and one-off scripts):
//                      per-record      what arrives, arrives one record at a time with a task between two (`arrive`): a producer that hands its records over as they come and not as one list
//                      all-rows        the Operations snapshot is made of new row objects after the first change: a body that gives every row a new object on every change (a tick renders every row in view)
//                      leaky-model     the models' `subscribe` lets go of nothing: a model that keeps a listener after it was stopped
//                      no-detach       the window does not release the Operations model's subscription to the feed when it goes (`unmount`)
//                      open-twice      the function that opens a row's subject is called twice for each activation: a row that opens its subject by the click and again by the button in it
//                      shift-other     the function that opens a row's subject is given ANOTHER subject when the shift key is down: a row whose shift-click opens something else than the row
//                      render-loop     the Operations body is drawn inside a component that renders again, for ever (a timer sets its state every 20 ms): a body in a render loop, which the page never rests from
//                      cells-twice     the table calls each column's `cell` twice for a row (the columns the probe watches are wrapped once more): every cell of a row that rendered is two calls and not one
//                      long-one        the layout scenes' long words are all in the first column (the Condition, the Operation), in every row (5 and 10 of them, more than any total of long words in the table asks for), and in no other column
//
// What the page exposes: `window.__commits` (every commit of the window's tree, React's Profiler: the probe builds this entry with the development build), `window.__bodyCommits` (the commits that rendered something inside
// the body of each tool) and `window.__po`, the controls: the models, the feed, the panel model, the builders of conditions and records, `arrive` (what a producer's list does to a tool), `tick` and `change` (one row), `layout`
// (long words and every state), `subscribers` (what each model and the feed hold: added, stopped, live, and heard after the stop), the calls the window was asked for (`opened`, `cancelled`, `read`), `cells` (the cells the
// tables rendered, by the key of their row) and `unmount`.
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { Profiler, useEffect, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { badgesOf } from '../../plugins/host/panelTools';
import type { ToolInput } from '../core/panel';
import { createActivityFeed, HOST_SOURCE, type ActivityProgress, type ActivityRecordLike, type SourceResolver, type TaskState } from '../panel/activity';
import { createOperations, OperationsBody, OPERATIONS_TOOL, OPERATIONS_TOOL_ID, type Operations } from '../panel/operations';
import { createProblems, ProblemsBody, PROBLEMS_TOOL, PROBLEMS_TOOL_ID, type Condition, type Problems } from '../panel/problems';
import type { OpenSubject, Subject } from '../panel/subject';
import { staticPanel } from '../panel/testing';
import { STATIC_RAIL, StaticShell } from '../testing';

type Kind = 'problems' | 'operations';

const params = new URLSearchParams(window.location.search);
const CONTROL = params.get('control') ?? '';
const TOOL = params.get('tool') ?? PROBLEMS_TOOL_ID;
const PANEL_OPEN = params.get('open') !== '0';
const APPLY_READ = params.get('read') === 'apply';

// ---------------------------------------------------------------------------------------------------------------------------
// What the window knows of plugins and connections: invented names. Two plugins with short names, and one whose name and connection are longer than any column.
const ALPHA = { id: 'alpha', name: 'Alpha Cloud' };
const BETA = { id: 'beta', name: 'Beta Works' };
const LONG = { id: 'long', name: 'A plugin whose name is much longer than the room its column gives it' };
const NAMES: Readonly<Record<string, string>> = { alpha: ALPHA.name, beta: BETA.name, long: LONG.name };
const CONNECTIONS: Readonly<Record<string, string>> = { 'alpha/c-1': 'north', 'beta/c-2': 'south', 'long/c-9': 'A connection with a name much longer than the room its column gives it' };
const resolve: SourceResolver = {
  plugin: (id) => (id === undefined || id === '' ? { id: HOST_SOURCE, name: 'Omniview' } : { id, name: NAMES[id] ?? id }),
  connection: (plugin, key) => CONNECTIONS[`${plugin}/${key}`],
};

// ---------------------------------------------------------------------------------------------------------------------------
// What the probe hands the tools, by hand. Problems: conditions, which a producer builds anew each time it says them. Operations: the activity service's task records, whose unchanged ones keep their identity (the runtime's store).
const pad = (index: number): string => String(index).padStart(3, '0');
const SOURCES = [ALPHA, BETA] as const;

type Shape = { readonly prefix?: string; readonly severity?: Condition['severity'] };

/** `count` conditions of one severity, from the two plugins in turn, a third of them about a connection; every call makes new objects. */
function conditions(count: number, { prefix = 'c', severity = 'error' }: Shape = {}): Condition[] {
  return Array.from({ length: count }, (_, index) => {
    const source = SOURCES[index % 2] ?? ALPHA;
    const subject: Subject = index % 3 === 0 ? { kind: 'connection', plugin: source.id, connection: source.id === 'alpha' ? 'c-1' : 'c-2' } : { kind: 'plugin', plugin: source.id };
    return {
      key: `${prefix}:${pad(index)}`,
      severity,
      label: `Label ${pad(index)}`,
      title: `${source.name}: the sentence of condition ${pad(index)}.`,
      source: { ...source },
      target: `item ${pad(index)}`,
      subject,
    };
  });
}

/**
 * Started two hours ago and a second more for each, newest first by index. The words of the Started column are the mock's rounding of the age (`operations/ago.ts`: "just now" below 45 s, then the nearest minute, hour and day), so
 * "2 h ago" holds from 1 h 29 m 30 s to 2 h 29 m 29 s. The 200 starts of a list are 2 h 0 m 0 s to 2 h 3 m 19 s old when the page loads, every one of them says "2 h ago" for 26 minutes after it, and a page of the probe (one for each
 * scene) lives for under a minute: no age label changes while a probe runs, so no node changes for one. (At 10 s apart the oldest rows were past the line already and those near it crossed it within two minutes.)
 */
const STARTED = Date.now() - 2 * 60 * 60 * 1000;
const startedAt = (index: number): string => new Date(STARTED - index * 1000).toISOString();

type TaskShape = {
  readonly title?: string;
  readonly state?: TaskState;
  readonly cancellation?: 'unsupported' | 'available' | 'requested' | 'acknowledged';
  readonly severity?: ActivityRecordLike['severity'];
  readonly read?: boolean;
  readonly plugin?: string | undefined;
  readonly connection?: string | undefined;
  readonly message?: string | undefined;
  readonly progress?: ActivityProgress | undefined;
  readonly index?: number;
};

function task(id: string, { title = `Work ${id}`, state = 'running', cancellation = 'unsupported', severity = 'info', read = false, plugin = 'alpha', connection, message, progress, index = 0 }: TaskShape = {}): ActivityRecordLike {
  return {
    id,
    kind: 'task',
    severity,
    createdAt: startedAt(index),
    source: { pluginID: plugin, connectionID: connection },
    presentation: { title, message, progress },
    task: { state, cancellation },
    visibility: { read },
  };
}

const units = (current: number, total: number, unit: string): ActivityProgress => ({ kind: 'units', current: String(current), total: String(total), unit });

/** `count` running tasks, from the two plugins in turn, a third of them cancellable and a third on a connection, each a count of 200 files of which `index` are done. */
function records(count: number, prefix = 't'): ActivityRecordLike[] {
  return Array.from({ length: count }, (_, index) =>
    task(`${prefix}${pad(index)}`, {
      title: `Work ${pad(index)}`,
      plugin: SOURCES[index % 2]?.id,
      connection: index % 3 === 0 ? (index % 2 === 0 ? 'c-1' : 'c-2') : undefined,
      cancellation: index % 3 === 1 ? 'available' : 'unsupported',
      progress: units(index, 200, 'files'),
      index,
    }),
  );
}

/** Longer than the widest room any column has at any window size the probe uses (1,430 px of table at 1440 px, about 90 characters in 600 px): every cell that draws words has to cut it. */
const WORDS = 'A name much too long for the room it is given, in every column that has to cut it, and then some more words after that, so that the sentence is longer than the whole table is wide even in the widest window of all. '.repeat(2).trim();

/** What the layout scenes draw: words longer than any column in every cell that draws words, one row of each shape. */
function layoutConditions(): Condition[] {
  if (CONTROL === 'long-one') {
    // The control `long-one`: every row's long words are in the Condition column and in no other: 5 of them, as many as a total over the whole table could ask for, all in ONE column.
    return Array.from({ length: 5 }, (_, index): Condition => ({ key: `l:${pad(index)}`, severity: 'error', label: WORDS, title: `${WORDS}.`, source: { ...ALPHA }, target: 'north', subject: { kind: 'plugin', plugin: 'alpha' } }));
  }

  const alpha = { ...ALPHA };
  return [
    { key: 'l:long', severity: 'error', label: WORDS, title: `${WORDS}.`, source: { ...LONG }, target: `A target with a name much longer than the room its column gives it, ${WORDS}`, subject: { kind: 'plugin', plugin: 'long' } },
    { key: 'l:short', severity: 'error', label: 'Did not load', title: 'Alpha Cloud: the plugin did not load.', source: alpha, target: 'north', subject: { kind: 'connection', plugin: 'alpha', connection: 'c-1' } },
    { key: 'l:none', severity: 'warning', label: 'Needs sign-in', title: 'Alpha Cloud: needs you to sign in.', source: alpha, target: undefined, subject: undefined },
    { key: 'l:info', severity: 'info', label: 'Update available', title: 'Alpha Cloud: a newer version is available.', source: { ...BETA }, target: 'Beta Works', subject: { kind: 'plugin', plugin: 'beta' } },
    { key: 'l:same', severity: 'warning', label: 'Same', title: 'Same', source: alpha, target: 'item', subject: { kind: 'plugin', plugin: 'alpha' } },
  ];
}

function layoutRecords(): ActivityRecordLike[] {
  if (CONTROL === 'long-one') {
    // The control `long-one`: every task's title is long (the Operation column) and nothing else in the row is: 10 of them, all in ONE column.
    return Array.from({ length: 10 }, (_, index) => task(`l${String(index + 1)}`, { title: `Reindexing: ${WORDS}`, plugin: 'alpha', connection: 'c-1', cancellation: 'available', progress: units(index, 100, 'items'), index }));
  }

  return [
    task('l1', { title: `Reindexing: ${WORDS}`, plugin: 'long', connection: 'c-9', cancellation: 'available', progress: units(1_234_567, 9_999_999, 'items processed so far'), index: 0 }),
    task('l2', { title: 'Syncing the catalogue', plugin: 'alpha', connection: 'c-1', cancellation: 'available', progress: { kind: 'steps', current: '2', total: '5', label: 'steps' }, index: 1 }),
    task('l3', { title: 'Waiting for a slot', state: 'starting', plugin: 'beta', index: 2 }),
    task('l4', { title: 'Exporting', state: 'paused', plugin: 'beta', connection: 'c-2', progress: units(50, 100, '%'), index: 3 }),
    task('l5', { title: 'Backing up', plugin: 'alpha', cancellation: 'requested', progress: { kind: 'indeterminate' }, index: 4 }),
    task('l6', { title: 'Restoring', state: 'succeeded', plugin: 'alpha', index: 5 }),
    task('l7', { title: 'Cleaning up', state: 'failed', severity: 'error', plugin: 'alpha', connection: 'c-1', message: 'The server did not answer', index: 6 }),
    task('l8', { title: 'Compacting', state: 'cancelled', plugin: 'beta', index: 7 }),
    task('l9', { title: 'Verifying', state: 'unknown', severity: 'warning', plugin: 'alpha', message: 'The producer was lost', index: 8 }),
    task('l10', { title: 'The host\'s own work', plugin: '', index: 9 }),
  ];
}

// ---------------------------------------------------------------------------------------------------------------------------
// What the window is told, and what the models hold.
type Opened = { readonly subject: Subject; readonly modifiers: string };
const opened: Opened[] = [];
const cancelled: string[] = [];
const read: string[] = [];

const control = createActivityFeed({
  cancel: async (id) => {
    cancelled.push(id);
  },
  markRead: async (id) => {
    read.push(id);
    if (APPLY_READ) {
      // The host's answer: the record comes back read, through the feed.
      control.push(control.feed.getSnapshot().map((record) => (record.id === id ? { ...record, visibility: { read: true } } : record)));
    }
  },
});

type Subscribable = { readonly subscribe: (listener: () => void) => () => void };
/** What a model, or the feed, was asked to hold: `live` is the subscriptions whose stop was not called, `heard` the calls a listener got after its stop was called (a stop that did not stop). */
type Tally = { added: number; stopped: number; live: number; heard: number };
const tally = (): Tally => ({ added: 0, stopped: 0, live: 0, heard: 0 });

/** The same model, whose `subscribe` is counted. */
function counted<T extends Subscribable>(target: T, into: Tally): T {
  return {
    ...target,
    subscribe: (listener) => {
      into.added += 1;
      into.live += 1;
      let stopped = false;
      const stop = target.subscribe(() => {
        if (stopped) {
          into.heard += 1;
        }

        listener();
      });
      return () => {
        if (stopped) {
          return;
        }

        stopped = true;
        into.stopped += 1;
        into.live -= 1;
        stop();
      };
    },
  };
}

/** The control `leaky-model`: a model whose stop function lets go of nothing. */
const leaky = <T extends Subscribable>(target: T): T => ({
  ...target,
  subscribe: (listener) => {
    target.subscribe(listener);
    return () => undefined;
  },
});

const tallies: Record<'problems' | 'operations' | 'feed', Tally> = { problems: tally(), operations: tally(), feed: tally() };
const feed = counted(control.feed, tallies.feed);
const problemsModel = createProblems();
const problems: Problems = counted(CONTROL === 'leaky-model' ? leaky(problemsModel) : problemsModel, tallies.problems);
const operationsModel = createOperations({ feed, resolve });
let operations: Operations = counted(CONTROL === 'leaky-model' ? leaky(operationsModel) : operationsModel, tallies.operations);
// The window's own subscription to the feed for as long as it is on screen (`attachPanelTools`).
const detach = operations.attach();

const modifiersOf = (event: Parameters<OpenSubject>[1]): string => [event?.metaKey === true ? 'meta' : '', event?.ctrlKey === true ? 'ctrl' : '', event?.altKey === true ? 'alt' : '', event?.shiftKey === true ? 'shift' : ''].filter(Boolean).join('+');
const open: OpenSubject = (subject, event) => {
  // The control `shift-other`: with the shift key down the call carries another subject than the row's (a row that opens something else than itself when it is shift-clicked).
  const given: Subject = CONTROL === 'shift-other' && event?.shiftKey === true ? { kind: 'plugin', plugin: 'elsewhere' } : subject;
  opened.push({ subject: given, modifiers: modifiersOf(event) });
  if (CONTROL === 'open-twice') {
    opened.push({ subject, modifiers: modifiersOf(event) });
  }
};

// ---------------------------------------------------------------------------------------------------------------------------
// The commits of the window's tree, and of the bodies of the two tools: React's Profiler calls `onRender` once for each commit that rendered something under it (the development build).
type Commit = { readonly phase: string; readonly actualDuration: number };
const commits: Commit[] = [];
const bodyCommits: Record<Kind, Commit[]> = { problems: [], operations: [] };
Reflect.set(window, '__commits', commits);
Reflect.set(window, '__bodyCommits', bodyCommits);

function profiled(kind: Kind, body: ReactElement): ReactElement {
  return (
    <Profiler
      id={kind}
      onRender={(_id, phase, actualDuration) => {
        bodyCommits[kind].push({ phase, actualDuration });
      }}
    >
      {body}
    </Profiler>
  );
}

/**
 * The control `render-loop`: the Operations body drawn inside a component that renders again, for ever, a tick of a timer after the one before: a body in a render loop. Each render is a commit of the window, so what the probe waits on
 * (`SETTLED`: the commits and the size of the document) never stops moving. A timer, and not a state that an effect sets after every render: React ends that loop with an error, and this page must make no error for the probe to see.
 */
function Looping(): ReactElement {
  const [, again] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      again((renders) => renders + 1);
    }, 20);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return <OperationsBody operations={operations} open={open} />;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The panel: the host's tools in the host's order (Terminal 10, Logs 20, Problems 30, Operations 40). Terminal and Logs are tools with no sessions here: they stand for the tool a person looks at instead.
const TOOLS: readonly ToolInput[] = [{ id: 'terminal', label: 'Terminal', icon: 'server', order: 10 }, { id: 'logs', label: 'Logs', icon: 'layers', order: 20 }, PROBLEMS_TOOL, OPERATIONS_TOOL];

const panel = staticPanel({
  tools: TOOLS,
  open: PANEL_OPEN,
  badges: badgesOf(problems, operations),
  renderTool: (tool) => {
    if (tool === PROBLEMS_TOOL_ID) {
      return profiled('problems', <ProblemsBody problems={problems} open={open} />);
    }

    if (tool === OPERATIONS_TOOL_ID) {
      return profiled('operations', CONTROL === 'render-loop' ? <Looping /> : <OperationsBody operations={operations} open={open} />);
    }

    return undefined;
  },
});
panel.store.activateTool(TOOL);

// ---------------------------------------------------------------------------------------------------------------------------
// The cells the tables render. The body hands the kit's table its columns, and the table calls a column's `cell` to render a row: wrapping them counts the rows that rendered, by the key of the row (the body tests do the same in
// jsdom, `watchCells`). The columns are found from the table's own element through React's link from a node to its fiber, as the DevTools find them.
type Fiber = { readonly memoizedProps?: unknown; readonly return: Fiber | null };
const isFiber = (value: unknown): value is Fiber => typeof value === 'object' && value !== null && 'return' in value;
type Table = { readonly columns: ReadonlyArray<Record<string, unknown>>; readonly keyOf: (row: unknown) => string };

function tableOf(label: string): Table | undefined {
  const region = document.querySelector(`[role="region"][aria-label="${label}"]`);
  const name = region === null ? undefined : Object.keys(region).find((key) => key.startsWith('__reactFiber$'));
  const start: unknown = region === null || name === undefined ? undefined : Reflect.get(region, name);
  for (let fiber = isFiber(start) ? start : null; fiber !== null; fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (typeof props === 'object' && props !== null && 'columns' in props && Array.isArray(props.columns) && 'getRowKey' in props && typeof props.getRowKey === 'function') {
      const getRowKey = props.getRowKey as (row: unknown) => unknown;
      return { columns: props.columns as ReadonlyArray<Record<string, unknown>>, keyOf: (row) => String(getRowKey(row)) };
    }
  }

  return undefined;
}

const calls = new Map<string, number>();
const undo: Array<() => void> = [];
const cells = {
  /** Wraps the cells of the table named `label` (the view's name: Problems, Operations) and says how many columns it wrapped: none when there is no table on screen. */
  watch: (label: string): number => {
    const table = tableOf(label);
    if (table === undefined) {
      return 0;
    }

    let wrapped = 0;
    for (const column of table.columns) {
      const original: unknown = Reflect.get(column, 'cell');
      if (typeof original !== 'function') {
        continue;
      }

      const counted = (row: unknown): unknown => {
        const key = table.keyOf(row);
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return (original as (row: unknown) => unknown)(row);
      };

      // The control `cells-twice`: the table calls the column's `cell` twice for a row, and draws the second call's answer.
      const twice = (row: unknown): unknown => {
        counted(row);
        return counted(row);
      };

      Reflect.set(column, 'cell', CONTROL === 'cells-twice' ? twice : counted);
      undo.push(() => {
        Reflect.set(column, 'cell', original);
      });
      wrapped += 1;
    }

    return wrapped;
  },
  /** The calls since the last take, by the key of the row, and the count starts again. */
  take: (): Record<string, number> => {
    const taken = Object.fromEntries(calls);
    calls.clear();
    return taken;
  },
  stop: (): void => {
    for (const restore of undo.splice(0)) {
      restore();
    }

    calls.clear();
  },
};

// ---------------------------------------------------------------------------------------------------------------------------
// What a producer does. The bulk list of each tool is kept, so that one change of it is one change of one member.
let bulk: Condition[] = [];

/** The control `per-record`: the producer says each member as it comes, a task after the one before it (each is its own task, so each is its own commit: a list said once is one). `say` is told the list so far. */
async function drip<T>(all: readonly T[], say: (sofar: readonly T[]) => void): Promise<void> {
  for (let index = 1; index <= all.length; index += 1) {
    say(all.slice(0, index));
    // The app's TypeScript library (ES2023) has no `Promise.withResolvers`: the promise is made with the executor.
    await new Promise<void>((done) => {
      setTimeout(done, 0);
    });
  }
}

/** What the control `all-rows` makes of the Operations snapshot: every change gives every row a new object, as a body that copies its rows would. */
function copiesRows(model: Operations): Operations {
  let from = model.getSnapshot();
  let made = { ...from, rows: from.rows.map((row) => ({ ...row })) };
  return {
    ...model,
    getSnapshot: () => {
      const now = model.getSnapshot();
      if (now !== from) {
        from = now;
        made = { ...now, rows: now.rows.map((row) => ({ ...row })) };
      }

      return made;
    },
  };
}

const api = {
  problems,
  operations,
  feed: control,
  store: panel.store,
  conditions,
  records,
  /** `count` conditions or tasks arrive from a producer: as one list, or (the control `per-record`) as one more member each task. */
  arrive: async (kind: Kind, count: number): Promise<void> => {
    if (kind === 'problems') {
      const all = conditions(count, { prefix: 'bulk' });
      const say = (list: readonly Condition[]): void => {
        bulk = [...list];
        problems.set('bulk', bulk);
      };

      if (CONTROL === 'per-record') {
        await drip(all, say);
        return;
      }

      say(all);
      return;
    }

    const held = control.feed.getSnapshot();
    const all = records(count, 'bulk');
    const say = (list: readonly ActivityRecordLike[]): void => {
      control.push([...held, ...list]);
    };

    if (CONTROL === 'per-record') {
      await drip(all, say);
      return;
    }

    say(all);
  },
  /** A few rows that are on screen before anything arrives, so that the table is drawn already. */
  seed: (kind: Kind, count: number): void => {
    if (kind === 'problems') {
      problems.set('seed', conditions(count, { prefix: 'seed' }));
      return;
    }

    control.push([...control.feed.getSnapshot(), ...records(count, 'seed')]);
  },
  /** The progress of one task of the feed: one record is new, and the others are the objects they were. */
  tick: (id: string, current: number): void => {
    control.push(control.feed.getSnapshot().map((record) => (record.id === id ? { ...record, presentation: { ...record.presentation, progress: units(current, 200, 'files') } } : record)));
  },
  /** The words of one condition of the bulk list: the producer says all of them again, as new objects, and this one's label is another. */
  change: (key: string, label: string): void => {
    bulk = conditions(bulk.length, { prefix: 'bulk' }).map((condition) => (condition.key === key ? { ...condition, label } : condition));
    problems.set('bulk', bulk);
  },
  /** A failure that nobody has read, which the Operations tab draws a dot for. */
  fail: (id: string): void => {
    control.push([...control.feed.getSnapshot(), task(id, { title: 'A failed export', state: 'failed', severity: 'error', message: 'The server did not answer', plugin: 'alpha', connection: 'c-1', index: 0 })]);
  },
  /** Long words in every cell that draws words, and one task of every state, with the conditions and tasks of the layout scenes. */
  layout: (): void => {
    problems.set('layout', layoutConditions());
    control.push([...control.feed.getSnapshot(), ...layoutRecords()]);
  },
  clear: (): void => {
    bulk = [];
    for (const producer of ['bulk', 'seed', 'layout']) {
      problems.set(producer, []);
    }

    control.push([]);
  },
  /** Each row of a tool in the model's order: its key (a condition's key, a task's id), the words its first cell says and where it goes. */
  rows: (kind: Kind): Array<{ readonly key: string; readonly name: string; readonly subject: Subject | undefined }> =>
    kind === 'problems'
      ? problems.getSnapshot().rows.map((row) => ({ key: row.key, name: row.label, subject: row.subject }))
      : operations.getSnapshot().rows.map((row) => ({ key: row.id, name: row.title, subject: row.subject })),
  subscribers: (): Record<keyof typeof tallies, Tally> => ({ problems: { ...tallies.problems }, operations: { ...tallies.operations }, feed: { ...tallies.feed } }),
  opened,
  cancelled,
  read,
  cells,
  /** The control `hidden-mounted`: a body of a tool that stays mounted, hidden, beside the window: a host that keeps what nobody looks at. */
  keepHidden: (kind: Kind): void => {
    const host = document.createElement('div');
    host.hidden = true;
    host.setAttribute('data-fixture', 'kept');
    document.body.append(host);
    createRoot(host).render(
      <ThemeProvider>
        <Profiler
          id={`kept-${kind}`}
          onRender={(_id, phase, actualDuration) => {
            commits.push({ phase, actualDuration });
          }}
        >
          {kind === 'problems' ? <ProblemsBody problems={problems} open={open} /> : <OperationsBody operations={operations} open={open} />}
        </Profiler>
      </ThemeProvider>,
    );
  },
  /** The window goes: its tree is unmounted, and the window lets go of what it attached (the control `no-detach` does not). */
  unmount: (): void => {
    root.unmount();
    if (CONTROL !== 'no-detach') {
      detach();
    }
  },
};

if (CONTROL === 'all-rows') {
  operations = counted(copiesRows(operationsModel), tallies.operations);
  api.operations = operations;
}

Reflect.set(window, '__po', api);

const root = createRoot(document.getElementById('root')!);
root.render(
  <ThemeProvider>
    <Profiler
      id="window"
      onRender={(_id, phase, actualDuration) => {
        commits.push({ phase, actualDuration });
      }}
    >
      <StaticShell registration={{ plugin: { name: 'Acme' }, rail: STATIC_RAIL }} panel={panel} />
    </Profiler>
    <TooltipHost />
  </ThemeProvider>,
);
