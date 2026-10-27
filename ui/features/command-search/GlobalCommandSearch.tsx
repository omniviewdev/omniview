import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { CommandList, Dialog, Hotkey, useCommandListConfig, useCommandListStoreContext } from '@omniviewdev/base-ui';
import { LuCommand, LuNavigation, LuSettings } from 'react-icons/lu';
import type { GlobalSearchController } from './controller';
import type { SearchRow, SearchSnapshot, SearchSource } from './types';
import styles from './GlobalCommandSearch.module.css';

const kindLabels = { command: 'Commands', setting: 'Settings', navigation: 'Navigation' };
const kindIcons = { command: LuCommand, setting: LuSettings, navigation: LuNavigation };

function getSettingBreadcrumb({ value }: SearchRow) {
  if (value.kind !== 'setting') {
    return undefined;
  }

  if (value.target.section === 'extensions') {
    return 'Settings › Extensions';
  }

  if (value.target.section === 'plugins') {
    return 'Settings › Plugins';
  }

  // The catalogue supplies the public category label as its first keyword.
  const category = value.target.settingId ? value.keywords?.[0] : undefined;
  return category ? `Settings › ${category}` : 'Settings › Application';
}

function getSourceStatusLabel(state: SearchSource['state']) {
  switch (state) {
    case 'unavailable':
      return 'Search source unavailable.';
    case 'source-limit':
      return 'Source limit reached; additional sources were not searched.';
    case 'truncated':
      return 'Additional results are not displayed.';
    case 'complete':
      return 'Search complete.';
    case 'pending':
    case 'queued':
      return 'Searching…';
  }
}

function SearchCombobox({ input }: { input: RefObject<HTMLInputElement | null> }) {
  const config = useCommandListConfig();
  const store = useCommandListStoreContext();
  const activeKey = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().activeKey,
    () => null,
  );
  useEffect(() => {
    if (activeKey !== null) {
      document.getElementById(`${config.listId}-item-${activeKey}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeKey, config.listId]);
  return (
    <CommandList.Input
      ref={input}
      autoFocus={false}
      role='combobox'
      aria-label='Search Omniview'
      aria-expanded='true'
      aria-haspopup='listbox'
      aria-activedescendant={activeKey === null ? undefined : `${config.listId}-item-${activeKey}`}
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          event.stopPropagation();
        }
      }}
    />
  );
}

type PaletteProps = {
  controller: GlobalSearchController | null;
  snapshot: SearchSnapshot;
  input: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  catalogueMessage?: string;
};

export function GlobalCommandSearch({ controller, snapshot, input, onClose, catalogueMessage }: PaletteProps) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (snapshot.isOpen) {
      input.current?.focus();
    }
  }, [snapshot.isOpen, input]);
  const disabledKeys = useMemo(
    () =>
      snapshot.rows
        .filter(
          (row) => row.disabledReason !== undefined || (snapshot.executionPending && row.value.kind === 'command'),
        )
        .map((row) => row.key),
    [snapshot.rows, snapshot.executionPending],
  );
  const loading = snapshot.sources.some((source) => source.state === 'queued' || source.state === 'pending');
  const sourceCounts = snapshot.sources.reduce<Partial<Record<SearchSource['state'], number>>>(
    (counts, source) => {
      counts[source.state] = (counts[source.state] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const sourceSummary = [
    (sourceCounts.pending ?? 0) + (sourceCounts.queued ?? 0) > 0 &&
      `${(sourceCounts.pending ?? 0) + (sourceCounts.queued ?? 0)} searching`,
    sourceCounts.complete && `${sourceCounts.complete} complete`,
    sourceCounts.unavailable && `${sourceCounts.unavailable} unavailable`,
    sourceCounts.truncated && `${sourceCounts.truncated} truncated`,
    sourceCounts['source-limit'] && `${sourceCounts['source-limit']} source-limited`,
  ].filter(Boolean).join(' · ');
  function containFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') {
      return;
    }

    const targets = surface.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), summary, input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    );
    const focusable = targets
      ? Array.from(targets).filter((target) => !target.closest('[hidden], [aria-hidden="true"]'))
      : [];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) {
      event.preventDefault();
      surface.current?.focus();
      return;
    }

    if (event.shiftKey && (document.activeElement === first || !surface.current?.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !surface.current?.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <Dialog ref={surface} open={snapshot.isOpen} onClose={onClose} size='lg' onKeyDown={containFocus}>
      <Dialog.Title>Search Omniview</Dialog.Title>
      <Dialog.Close aria-label='Close search' />
      <Dialog.Body>
        <CommandList<SearchRow>
          role='presentation'
          aria-expanded={undefined}
          aria-haspopup={undefined}
          aria-owns={undefined}
          aria-activedescendant={undefined}
          items={snapshot.rows}
          itemKey={(row) => row.key}
          getTextValue={(row) => row.label}
          query={snapshot.query}
          onQueryChange={(query) => controller?.setQuery(query)}
          sortByScore={false}
          groupBy={(row) => row.value.kind}
          groupLabel={(kind) => kindLabels[kind as keyof typeof kindLabels]}
          virtualized={false}
          disabledKeys={disabledKeys}
          loading={loading}
          aria-busy={snapshot.executionPending || undefined}
          placeholder='Search anything…'
          onAction={(key) => {
            void controller?.activate(String(key));
          }}
          onDismiss={onClose}
          onKeyDownCapture={(event) => {
            if (event.target !== input.current && (event.key === 'Enter' || event.key === ' ')) {
              event.stopPropagation();
            }
          }}
          renderItem={(row) => {
            const Icon = kindIcons[row.value.kind];
            const breadcrumb = getSettingBreadcrumb(row);
            return (
              <CommandList.Item
                itemKey={row.key}
                disabled={Boolean(row.disabledReason) || (snapshot.executionPending && row.value.kind === 'command')}
              >
                <CommandList.ItemIcon aria-hidden='true'><Icon /></CommandList.ItemIcon>
                <CommandList.ItemContent>
                  <CommandList.ItemLabel>{row.label}</CommandList.ItemLabel>
                  {breadcrumb && <CommandList.ItemMeta>{breadcrumb}</CommandList.ItemMeta>}
                  {row.value.description && (
                    <CommandList.ItemDescription>{row.value.description}</CommandList.ItemDescription>
                  )}
                  {row.disabledReason && (
                    <CommandList.ItemDisabledReason>{row.disabledReason}</CommandList.ItemDisabledReason>
                  )}
                </CommandList.ItemContent>
              </CommandList.Item>
            );
          }}
        >
          <SearchCombobox input={input} />
          <CommandList.Results className={styles.Results} />
          {!loading && <CommandList.Empty>No matching commands, settings or navigation.</CommandList.Empty>}
          <CommandList.Loading>Searching external sources…</CommandList.Loading>
        </CommandList>
        {(Boolean(snapshot.message) || Boolean(catalogueMessage)) && (
          <p role='status'>{[snapshot.message, catalogueMessage].filter(Boolean).join(' ')}</p>
        )}
        {snapshot.sources.length > 0 && (
          <details className={styles.SourceDetails}>
            <summary>Search sources · {sourceSummary}</summary>
            <ul className={styles.Sources} aria-label='Search source status'>
              {snapshot.sources.map((source) => (
                <li key={source.id}>{source.label}: {getSourceStatusLabel(source.state)}</li>
              ))}
            </ul>
          </details>
        )}
        {snapshot.feedback && (
          <p role='status' aria-live='polite'>
            {snapshot.feedback.message}
            {snapshot.feedback.code && ` (${snapshot.feedback.code})`}
            {snapshot.feedback.requestId && ` Request: ${snapshot.feedback.requestId}`}
          </p>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        <div className={styles.KeyboardHints} aria-label='Keyboard shortcuts'>
          <span><Hotkey>↑</Hotkey><Hotkey>↓</Hotkey> Navigate</span>
          <span><Hotkey>Enter</Hotkey> Open</span>
          <span><Hotkey>Esc</Hotkey> Close</span>
        </div>
      </Dialog.Footer>
    </Dialog>
  );
}
