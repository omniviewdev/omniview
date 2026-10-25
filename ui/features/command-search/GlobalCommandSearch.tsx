import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { CommandList, Dialog, useCommandListConfig, useCommandListStoreContext } from '@omniviewdev/base-ui';
import type { GlobalSearchController } from './controller';
import type { SearchRow, SearchSnapshot, SearchSource } from './types';
import styles from './GlobalCommandSearch.module.css';

function getRowKindLabel({ value }: SearchRow) {
  if (value.kind !== 'setting' || value.target.section === 'extensions') {
    return value.kind;
  }

  const categoryOrPlugin = value.target.section === 'core' ? value.target.categoryId : value.target.pluginId;
  return `${value.kind} · ${value.target.settingId ?? categoryOrPlugin}`;
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
      aria-label='Search commands, settings and navigation'
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
        .filter((row) => row.disabledReason !== undefined || snapshot.executionPending)
        .map((row) => row.key),
    [snapshot.rows, snapshot.executionPending],
  );
  const loading = snapshot.sources.some((source) => source.state === 'queued' || source.state === 'pending');
  function containFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') {
      return;
    }

    const targets = surface.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
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
      <Dialog.Title>Search commands, settings and navigation</Dialog.Title>
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
          virtualized={false}
          disabledKeys={disabledKeys}
          loading={loading}
          aria-busy={snapshot.executionPending || undefined}
          placeholder='Search commands, settings and navigation…'
          onAction={(key) => {
            void controller?.activate(String(key));
          }}
          onDismiss={onClose}
          onKeyDownCapture={(event) => {
            if (event.target !== input.current && (event.key === 'Enter' || event.key === ' ')) {
              event.stopPropagation();
            }
          }}
          renderItem={(row) => (
            <CommandList.Item itemKey={row.key} disabled={Boolean(row.disabledReason) || snapshot.executionPending}>
              <div className={styles.Row}>
                <CommandList.ItemLabel>{row.label}</CommandList.ItemLabel>
                <span className={styles.Kind}>{getRowKindLabel(row)}</span>
                {row.value.description && (
                  <CommandList.ItemDescription>{row.value.description}</CommandList.ItemDescription>
                )}
                {row.disabledReason && <CommandList.ItemDescription>{row.disabledReason}</CommandList.ItemDescription>}
              </div>
            </CommandList.Item>
          )}
        >
          <SearchCombobox input={input} />
          <CommandList.Results className={styles.Results} />
          {!loading && <CommandList.Empty>No matching commands, settings or navigation.</CommandList.Empty>}
          <CommandList.Loading>Searching external sources…</CommandList.Loading>
        </CommandList>
        {(Boolean(snapshot.message) || Boolean(catalogueMessage)) && (
          <p role='status'>{[snapshot.message, catalogueMessage].filter(Boolean).join(' ')}</p>
        )}
        {snapshot.sources.some((source) => source.state !== 'complete') && (
          <ul className={styles.Sources} aria-label='Search source status'>
            {snapshot.sources
              .filter((source) => source.state !== 'complete')
              .map((source) => (
                <li key={source.id}>
                  {source.label}: {getSourceStatusLabel(source.state)}
                </li>
              ))}
          </ul>
        )}
        {snapshot.feedback && (
          <p role='status' aria-live='polite'>
            {snapshot.feedback.message}
            {snapshot.feedback.code && ` (${snapshot.feedback.code})`}
            {snapshot.feedback.requestId && ` Request: ${snapshot.feedback.requestId}`}
          </p>
        )}
      </Dialog.Body>
    </Dialog>
  );
}
