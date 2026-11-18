import { Button, DataView, PageHeader, SearchField, WorkspaceToolbar, type PageHeaderCommands } from '@omniviewdev/kit';
import { useState, type MouseEvent } from 'react';
import type { ListPageDefinition, ListSource } from './definition';
import styles from './ListPage.module.css';
import { refreshReason } from './refresh';
import { useRefreshFeedback } from './useRefreshFeedback';
import { useSearchDraft } from './useSearchDraft';
import { deriveListView, normalizeSearch } from './view';

export type ListPageProps<TRow> = {
  readonly definition: ListPageDefinition<TRow>;
  readonly source: ListSource<TRow>;
};

/**
 * The list page of a collection (slice 1a plan 1.1, 3.1): the page header with its Refresh command and its operation slot, the quick
 * filters, the toolbar with the search, the table, and the footer's count, in one pane (`DataView`). It is a pure function of its
 * definition and its source: it reads no data layer and knows no plugin. What the person typed (the search, the chosen filter) is the page's
 * own state; what is listed, in what order, and whether it is all of it, is the source's.
 *
 * The search is applied 500 ms after the last key, at once on Enter or when it is cleared. A filter chosen twice is cleared. One Clear
 * filters command, in the toolbar, drops both. The user's own Refresh is felt: the header's slot says "Refreshing…" and then "Updated".
 */
export function ListPage<TRow>({ definition, source }: ListPageProps<TRow>) {
  const search = useSearchDraft();
  const [chosen, setChosen] = useState<string | null>(null);
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
    setChosen(null);
    toolbar?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  };

  return (
    <>
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
                setChosen((current) => (id === null || id === current ? null : id));
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
        table={{ rows: view.rows, getRowKey: definition.getRowKey, columns: definition.columns, lines: definition.lines, rowsAreImmutable: true }}
        footer={{ shown: view.footer.shown, total: view.footer.total, noun: definition.nouns.one, plural: definition.nouns.other }}
        state={view.state}
      />
      {/* Always in the page, empty at rest: a live region that appears together with its text is not announced. */}
      <span className={styles.live} role="status">
        {feedback.announcement}
      </span>
    </>
  );
}
