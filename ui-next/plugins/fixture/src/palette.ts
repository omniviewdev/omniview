import type { IconName } from '@omniviewdev/kit';
import type { PaletteProviderV1, PaletteRowV1, PaletteSearchProviderV1, PaletteV1, RouteV1 } from '../../contract/v1';
import { ITEMS } from './items';

// The fixture's palette contribution (C1c): the providers a plugin brings to the command palette, as small as they can be and still be the real thing. One `match` provider offers the plugin's own pages and its one
// command; three `search` providers answer on demand, and differ only in what they are told to cost: `quick` answers at once, `slow` after 300 ms, and `big` returns five thousand rows. The probes control them through
// `window.__fixturePalette` and read what they did from it, so the palette's behaviour with a provider that is slow, large, failing or deaf to its signal is proved in a real engine against a provider that is exactly
// that and not a stand-in for one.
//
// THE FIXTURE IS QUIET UNLESS ASKED. `window.__fixturePalette` does not exist until a check makes it, and while it does not every provider's `supports` says it has nothing to say, so the palette asks none of them and the
// other checks (which search for pages and commands of the host) see nothing of this plugin's. A check that wants them writes `window.__fixturePalette = { stats: {}, commands: [] }` (and any of the members below)
// before it types:
//
//   quick, slow, big   { delay?: ms, size?: rows, fail?, spin?, listen? }   what each search provider costs; defaults 0 ms / 5 rows, 300 ms / 5 rows, 0 ms / 0 rows (`big` is off until given a size)
//   fail               'throw' (the provider throws as it is called), 'reject' (it rejects), 'hang' (it never answers), 'garbage' (it answers what is not a list), 'rows' (a row of its answer is not valid, as a
//                      glyph the kit does not have)
//   spin               the provider holds the thread for its delay, as a provider that computes and does not wait would: nothing else of the page runs meanwhile
//   listen             false: the provider does not hear its signal, so it answers after it was told to stop (the palette must not show that)
//   stats              by `<plugin>/<provider>`: { calls, aborted, answered, active }, kept by the provider (`aborted` counts the requests it was told to stop before it answered)
//   commands           what the plugin's one command was run with: { arg, plugin, panel }

type Failure = '' | 'throw' | 'reject' | 'hang' | 'garbage' | 'rows';

export type Costs = {
  readonly delay: number;
  readonly size: number;
  readonly fail: Failure;
  readonly spin: boolean;
  readonly listen: boolean;
};

export type Stat = { calls: number; aborted: number; answered: number; active: number };

type Control = Partial<Record<'quick' | 'slow' | 'big', Partial<Costs>>> & {
  stats: Record<string, Stat>;
  commands: unknown[];
};

const isControl = (value: unknown): value is Control => typeof value === 'object' && value !== null && 'stats' in value && 'commands' in value;

/** The control a check made, or `undefined` while none did. */
const controlOf = (): Control | undefined => {
  const found: unknown = Reflect.get(window, '__fixturePalette');
  return isControl(found) ? found : undefined;
};

const statOf = (control: Control, key: string): Stat => (control.stats[key] ??= { calls: 0, aborted: 0, answered: 0, active: 0 });

/** Waits `ms`, and, when `signal` is given, stops waiting (rejecting) the moment it aborts: a provider that hears its signal. */
async function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('The fixture was told to stop.', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** Holds the thread for `ms`, as work that computes and does not wait does. */
function spin(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // busy: the page does nothing else until this ends
  }
}

type Named = 'quick' | 'slow' | 'big';

const DEFAULTS: Readonly<Record<Named, Costs>> = {
  quick: { delay: 0, size: 5, fail: '', spin: false, listen: true },
  slow: { delay: 300, size: 5, fail: '', spin: false, listen: true },
  big: { delay: 0, size: 0, fail: '', spin: false, listen: true },
};

const SECTIONS: Readonly<Record<Named, string>> = { quick: 'Items', slow: 'Slow items', big: 'Bulk items' };

/** The rows of the items whose name holds `query`, as resources of the plugin: the detail page of each. */
function itemRows(query: string, size: number, route: (name: string) => RouteV1): PaletteRowV1[] {
  const wanted = query.trim().toLowerCase();
  return ITEMS.filter((item) => item.name.includes(wanted))
    .slice(0, size)
    .map((item) => ({ id: `item:${item.name}`, label: item.name, secondary: `Item · ${item.group}`, icon: 'box', route: route(item.name) }));
}

/** `size` rows that are all answers to `query`: the answer of a provider that has far more than the palette will show. */
function bulkRows(query: string, size: number, route: (name: string) => RouteV1): PaletteRowV1[] {
  return Array.from({ length: size }, (_, index) => {
    const number = String(index).padStart(4, '0');
    return { id: `bulk:${number}`, label: `${query.trim()} ${number}`, secondary: 'Bulk', icon: 'box', route: route(`bulk-${number}`) };
  });
}

function searchOf(owner: string, name: Named, route: (name: string) => RouteV1): PaletteSearchProviderV1 {
  return {
    kind: 'search',
    section: SECTIONS[name],
    // Nothing is asked until a check made the control: the palette leaves a provider that says so alone.
    supports: () => controlOf() !== undefined,
    search: async (query, _scope, signal) => {
      const control = controlOf();
      if (control === undefined) {
        return [];
      }

      const costs: Costs = { ...DEFAULTS[name], ...control[name] };
      const stat = statOf(control, `${owner}/${name}`);
      let finished = false;
      stat.calls += 1;
      stat.active += 1;
      const told = (): void => {
        if (!finished) {
          stat.aborted += 1;
        }
      };

      signal.addEventListener('abort', told, { once: true });
      try {
        if (costs.fail === 'throw') {
          throw new Error('The fixture provider failed on purpose.');
        }

        if (costs.fail === 'hang') {
          return await new Promise<never>(() => undefined);
        }

        if (costs.spin) {
          spin(costs.delay);
        } else {
          await wait(costs.delay, costs.listen ? signal : undefined);
        }

        if (costs.fail === 'reject') {
          throw new Error('The fixture provider rejected on purpose.');
        }

        if (costs.fail === 'garbage') {
          return 7 as never;
        }

        const rows = name === 'big' ? bulkRows(query, costs.size, route) : itemRows(query, costs.size, route);
        stat.answered += 1;
        // A row the host must leave out, with a problem for this provider: a glyph the kit does not have.
        const notAGlyph: IconName = 'no-such-glyph' as IconName;
        return costs.fail === 'rows' ? [...rows, { id: 'bad', label: 'Not valid', icon: notAGlyph, route: route('orders-api') }] : rows;
      } finally {
        finished = true;
        stat.active -= 1;
        signal.removeEventListener('abort', told);
      }
    },
  };
}

/**
 * The fixture's `palette` member, for the plugin called `owner` in the stats (two plugins are built from one source, so they are told apart by their rail label). `detail` is the route of an item's page and `list` the route of the
 * plugin's list page: the host's own probe fixture has pages of its own, and names them here.
 */
export function createFixturePalette(owner: string, detail: (name: string) => RouteV1, list: RouteV1): PaletteV1 {
  const providers: Record<string, PaletteProviderV1> = {
    pages: {
      kind: 'match',
      section: 'Fixture pages',
      supports: () => controlOf() !== undefined,
      match: () => [
        { id: 'list', label: 'Fixture list', secondary: 'Everything in one place', keywords: 'catalogue', icon: 'layers', route: list },
        { id: 'reset', label: 'Reset fixture counters', secondary: 'Command', keywords: 'clear', icon: 'refresh', command: { id: 'reset', arg: { owner } } },
      ],
    },
    quick: searchOf(owner, 'quick', detail),
    slow: searchOf(owner, 'slow', detail),
    big: searchOf(owner, 'big', detail),
  };
  return {
    providers,
    commands: {
      reset: {
        run: (arg, context) => {
          controlOf()?.commands.push({ arg, plugin: context.plugin, panel: context.panel !== undefined });
        },
      },
    },
  };
}
