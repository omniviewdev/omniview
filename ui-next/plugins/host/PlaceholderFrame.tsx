import { useMemo } from 'react';
import { ListPage, type ListPageDefinition, type ListSource, type ListSourceState } from '../../page';
import { Shell, type ShellSidebar } from '../../shell';

// The frame the host draws when it has no page of a plugin to draw: the plugin's interface is loading, did not load, or one of its pages failed. It is the
// shell and the list page over a source with no rows, so the state is the kit's own collection state (a loading skeleton, or the one notice with its Retry),
// drawn where the page would be, with the sidebar still there to leave by. The host words every state; the plugin's own text is never drawn here (it goes
// to the log: whether a diagnostic may be shown behind "Details" is decision B6).

const NO_ROWS: readonly never[] = [];

/** A list page with nothing to list under a title: its columns are never drawn, because the body is a state. */
function stub(title: string): ListPageDefinition<never> {
  return { title, nouns: { one: title, other: title }, columns: [], lines: 1, getRowKey: () => '', searchText: () => '' };
}

export type PlaceholderFrameProps = {
  readonly pluginName: string;
  /** The plural name the state is worded with: "Couldn't load <title>". */
  readonly title: string;
  readonly state: ListSourceState;
  /** An empty set rather than a state: nothing to show and nothing wrong. */
  readonly empty?: boolean;
  readonly sidebar?: ShellSidebar | undefined;
  readonly onChoose?: ((id: string) => void) | undefined;
};

export function PlaceholderFrame({ pluginName, title, state, empty = false, sidebar, onChoose }: PlaceholderFrameProps) {
  const definition = useMemo(() => stub(title), [title]);
  // The page's Refresh asks again for what failed; with nothing failed there is nothing to ask for.
  const refresh = async (): Promise<void> => {
    if (state.kind === 'failed') {
      state.retry?.();
    }
  };

  const source: ListSource<never> = { state, rows: NO_ROWS, complete: empty, refreshing: false, refresh };

  return (
    <Shell
      registration={{
        plugin: { name: pluginName },
        tab: { title, icon: state.kind === 'failed' ? 'status-error' : 'box' },
        path: [pluginName, title],
        layout: 'pane',
        ...(sidebar === undefined ? {} : { sidebar }),
      }}
      onChoose={onChoose}
    >
      <ListPage definition={definition} source={source} />
    </Shell>
  );
}
