import { Button, DataView, PageHeader, SearchField, WorkspaceToolbar, type DataTableSort, type PageHeaderCommands } from '@omniviewdev/kit';
import { useRef, useState, type MouseEvent } from 'react';
import type { ListPageDefinition, ListSource } from './definition';
import { keepFilter, keepSearch, keptFilter, keptSearch } from './kept';
import styles from './ListPage.module.css';
import type { PageMemory } from './memory';
import { refreshReason } from './refresh';
import { keepSort, keptSort, sortInForce } from './sort';
import { useRefreshFeedback } from './useRefreshFeedback';
import { SEARCH_DELAY_MS, useSearchDraft } from './useSearchDraft';
import { useScrollMemory } from './useScrollMemory';
import { deriveListView, normalizeSearch } from './view';

export type ListPageProps<TRow> = {
  readonly definition: ListPageDefinition<TRow>;
  readonly source: ListSource<TRow>;
  /**
   * Where the page keeps what the person chose in it, for the host to give back when the page is drawn again (`PageMemory`): the sort, the search they applied, the quick filter, and where the table is
   * scrolled (H7). Absent: they live as long as the page is mounted. The page writes each when the person chooses it, and reads them once, when it opens.
   */
  readonly memory?: PageMemory | undefined;
};

/**
 * The list page of a collection (slice 1a plan 1.1, 3.1): the page header with its Refresh command and its operation slot, the quick
 * filters, the toolbar with the search, the table, and the footer's count, in one pane (`DataView`). It is a pure function of its
 * definition, its source and what the person chose: it reads no data layer and knows no plugin. What the person typed (the search, the
 * chosen filter) and the sort they chose are the page's own state; what is listed, and whether it is all of it, is the source's.
 *
 * The sort is the table's work and the page's choice (K3a): the page holds the sort in force, which is what the person chose, else the
 * definition's `defaultSort`, and only ever a column that declares a sort key; the table sorts the rows by it (stably: a tie keeps the
 * source's order), says it in the header (`aria-sort`) and turns a column round on its second press. With no sort in force the rows are
 * the source's, in its order, and a list whose columns declare no key has no sort button at all.
 *
 * The search is applied 500 ms after the last key, at once on Enter or when it is cleared. A filter chosen twice is cleared. One Clear
 * filters command, in the toolbar, drops both (not the sort). The user's own Refresh is felt: the header's slot says "Refreshing…" and then "Updated".
 *
 * What the person chose is kept for the host to give back (H7, `kept.ts`): the sort, the applied search, the chosen filter and where the table is scrolled (`useScrollMemory`) are written as they change and read
 * once, as the page opens, so a page that is drawn again (Back, Forward, a reload, a page the keep-alive cap let go) is as it was left. Nothing is written when the page opens or while it is left alone.
 */
export function ListPage<TRow>({ definition, source, memory }: ListPageProps<TRow>) {
  // What the host held when the page was drawn: the sort, the search, the filter and the position it was left with. Read once.
  const [opened] = useState(() => memory?.read());
  const search = useSearchDraft(SEARCH_DELAY_MS, {
    initial: keptSearch(opened),
    onApply: (query) => {
      memory?.write(keepSearch(memory.read(), query));
    },
  });
  const [chosen, setChosen] = useState<string | null>(() => keptFilter(opened, definition.quickFilters?.filters));
  const [chosenSort, setChosenSort] = useState<DataTableSort | undefined>(() => keptSort(definition.columns, opened));
  const page = useRef<HTMLDivElement>(null);
  const scroll = useScrollMemory({ root: page, memory, opened, label: definition.title, settled: source.complete && source.state.kind === 'ready' });
  const sort = sortInForce(definition.columns, chosenSort, definition.defaultSort);
  const failed = source.state.kind === 'failed';
  const feedback = useRefreshFeedback({ title: definition.title, refresh: source.refresh, failed });
  const view = deriveListView(definition, source, { text: normalizeSearch(search.query), filter: chosen });

  const commands: PageHeaderCommands = {
    ...definition.commands,
    utility: {
      id: 'refresh',
      label: `Refresh ${definition.title}`,
      icon: 'refresh',
      onSelect: feedback.ask,
      disabledReason: refreshReason(feedback.felt || source.refreshing, source.state.kind === 'loading'),
    },
  };

  const clear = (event: MouseEvent<HTMLButtonElement>) => {
    // The command is about to go: the focus goes back to the search it clears, as the mock's does, not to the page.
    const toolbar = event.currentTarget.closest('[role="group"]');
    search.clear();
    if (chosen !== null) {
      setChosen(null);
      memory?.write(keepFilter(memory.read(), null));
    }

    toolbar?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  };

  // The person pressed a header: the table says which sort that makes (it turns a column round, or sorts another ascending); the page holds it and writes it down for the host to give back.
  const sortBy = (next: DataTableSort) => {
    setChosenSort(next);
    memory?.write(keepSort(memory.read(), next));
  };

  // The wrapper takes no room (`display: contents`): it is the element that hears the table's scrolling and the presses that may take the page away, and where the table is looked for to put it back.
  return (
    <div className={styles.page} ref={page} onScrollCapture={scroll.onScrollCapture} onPointerDownCapture={scroll.flush} onKeyDownCapture={scroll.flush}>
      <DataView<TRow>
        label={definition.title}
        header={<PageHeader title={definition.title} tile={definition.tile} commands={commands} operation={feedback.operation} />}
        quickFilters={
          view.quickFilters === undefined
            ? undefined
            : {
              label: view.quickFilters.label,
              total: view.quickFilters.total,
              filters: view.quickFilters.filters,
              selected: chosen,
              onSelect: (id) => {
                const next = id === null || id === chosen ? null : id;
                if (next !== chosen) {
                  setChosen(next);
                  memory?.write(keepFilter(memory.read(), next));
                }
              },
            }
        }
        toolbar={
          <WorkspaceToolbar label={`Search and filter ${definition.title}`}>
            <SearchField label={`Search ${definition.title}`} value={search.draft} onValueChange={search.change} onSubmit={search.flush} />
            {view.active ? (
              <Button variant="ghost" size="compact" icon="close" onClick={clear}>
                Clear filters
              </Button>
            ) : null}
          </WorkspaceToolbar>
        }
        table={{ rows: view.rows, getRowKey: definition.getRowKey, columns: definition.columns, lines: definition.lines, sort, onSortChange: sortBy, rowsAreImmutable: true }}
        footer={{ shown: view.footer.shown, total: view.footer.total, noun: definition.nouns.one, plural: definition.nouns.other }}
        state={view.state}
      />
      {/* Always in the page, empty at rest: a live region that appears together with its text is not announced. */}
      <span className={styles.live} role="status">
        {feedback.announcement}
      </span>
    </div>
  );
}
