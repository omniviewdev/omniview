import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { Banner, Button, Chip, CommandList, Dialog, Hotkey, IconButton, SearchInput as BaseSearchInput, useCommandListConfig } from '@omniviewdev/base-ui';
import { LuBox, LuChevronRight, LuCircleAlert, LuCircleCheck, LuCommand, LuEllipsis, LuInfo, LuKeyRound, LuLayers, LuLoaderCircle, LuNavigation, LuPlug, LuPlus, LuRefreshCw, LuSettings, LuShieldAlert, LuTriangleAlert, LuUnplug, LuX } from 'react-icons/lu';
import { ResourceIcon } from '@omniviewdev/runtime';
import Icon from '@/components/icons/Icon';
import { IsImage } from '@/utils/url';
import { dispositionFor } from '@/features/workspace/newTab/openDisposition';
import type { GlobalSearchController } from './controller';
import type { SearchRow, SearchScopeV1, SearchSnapshot, SearchSource } from './types';
import { SearchProviderContexts, type SearchProviderContextRegistration } from './SearchProviderContexts';
import { scopeConnection, scopeDetails, scopeType } from './scope';
import styles from './GlobalCommandSearch.module.css';

const kindLabels = { command: 'Commands', setting: 'Settings', navigation: 'Navigation', action: 'Actions' };
const kindIcons = { command: LuCommand, setting: LuSettings, navigation: LuNavigation, action: LuCommand };
const MOD_KEY = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent) ? 'Meta' : 'Control';
const scopeIcons = { connection: LuPlug, 'resource-type': LuLayers, resource: LuBox };
const scopeLabels = { connection: 'Connection', 'resource-type': 'Resource type', resource: 'Resource' };
const rowKey = (row: SearchRow) => row.key;
const rowLabel = (row: SearchRow) => row.label;
// Providers/controller already filter and rank, including matches outside the display label.
const includeRankedRow = () => true;

// Local presentation IDs are not canonical resource keys.
const scopeIds = new WeakMap<SearchScopeV1, number>();
let nextScopeId = 0;
function scopeKey(scope: SearchScopeV1) {
  let id = scopeIds.get(scope);
  if (id === undefined) {
    id = ++nextScopeId;
    scopeIds.set(scope, id);
  }

  return String(id);
}

function scopeDescription(scope: SearchScopeV1) {
  return [
    `${scopeLabels[scope.kind]}: ${scope.label}`, scope.pluginId, scopeConnection(scope),
    scopeType(scope),
    scopeDetails(scope),
    scope.kind === 'resource' && scope.reference.address.id,
  ].filter(Boolean).join(' · ');
}

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

const sourceVisuals = {
  unavailable: { label: 'Unavailable', Icon: LuCircleAlert, color: 'danger' },
  'source-limit': { label: 'Source limit', Icon: LuEllipsis, color: 'neutral' },
  truncated: { label: 'More results', Icon: LuEllipsis, color: 'neutral' },
  complete: { label: 'Ready', Icon: LuCircleCheck, color: 'neutral' },
  disconnected: { label: 'Disconnected', Icon: LuUnplug, color: 'warning' },
  connecting: { label: 'Connecting', Icon: LuLoaderCircle, color: 'info' },
  'authentication-required': { label: 'Sign-in required', Icon: LuKeyRound, color: 'warning' },
  forbidden: { label: 'Access denied', Icon: LuShieldAlert, color: 'danger' },
  partial: { label: 'Partial results', Icon: LuTriangleAlert, color: 'warning' },
  pending: { label: 'Searching', Icon: LuLoaderCircle, color: 'neutral' },
  queued: { label: 'Searching', Icon: LuLoaderCircle, color: 'neutral' },
} as const;

function getSourceStatusLabel(state: SearchSource['state']) {
  return sourceVisuals[state].label;
}

function isDisabled(row: SearchRow, pending: boolean, searchPending = false) {
  return searchPending || row.disabledReason !== undefined || (pending && (row.value.kind === 'command' || row.value.kind === 'action'));
}

function supportsScope(scope: SearchScopeV1 | undefined, parent: SearchScopeV1 | undefined) {
  return scope && (
    (scope.kind === 'connection' && !parent) ||
    (scope.kind === 'resource-type' && parent?.kind === 'connection') ||
    (scope.kind === 'resource' && parent?.kind === 'resource-type')
  );
}

function ScopeIcon({ scope, pluginIcons }: { scope: SearchScopeV1; pluginIcons?: ReadonlyMap<string, string> }) {
  const icon = scope.kind === 'connection' ? pluginIcons?.get(scope.pluginId) : undefined;
  if (icon) {
    return IsImage(icon)
      ? <img src={icon} alt='' className={styles.PluginIcon} />
      : <Icon name={icon} aria-hidden='true' />;
  }

  const Fallback = scopeIcons[scope.kind];
  return scope.kind === 'connection' ? <Fallback aria-hidden='true' /> : (
    <ResourceIcon pluginId={scope.pluginId} resourceKey={scopeType(scope)!} size={16}
      aria-hidden='true' fallback={<Fallback aria-hidden='true' />} />
  );
}

function NewTabIcon({ row, pluginIcons }: { row: SearchRow; pluginIcons?: ReadonlyMap<string, string> }) {
  const icon = row.value.kind === 'navigation' && row.value.target.kind === 'plugin' ? pluginIcons?.get(row.value.target.pluginId) : undefined;
  if (!icon) {
    return <LuPlus aria-hidden='true' />;
  }

  return IsImage(icon) ? <img src={icon} alt='' className={styles.PluginIcon} /> : <Icon name={icon} aria-hidden='true' />;
}

function isComposing(event: KeyboardEvent) {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

function SearchInput({ controller, snapshot, input, onClose, pluginIcons }: PaletteProps) {
  const config = useCommandListConfig();
  const [selectedScope, setSelectedScope] = useState<string>();
  const descriptionId = useId();
  const selectedScopeIndex = snapshot.scopes.findIndex((scope) => scopeKey(scope) === selectedScope);
  const selectedRow = snapshot.rows.find((row) => row.key === snapshot.selectedKey);
  const eligibleRow = selectedRow && !isDisabled(selectedRow, snapshot.executionPending, snapshot.searchPending) ? selectedRow : undefined;
  const scopeStackKey = snapshot.scopes.map(scopeKey).join('\n');
  const previousScope = useRef({ isOpen: false, key: '' });
  const scopeableRow = supportsScope(eligibleRow?.value.scope, snapshot.scopes.at(-1)) ? eligibleRow : undefined;

  // Scope transitions commit new chip controls before returning focus to the query.
  useLayoutEffect(() => {
    if (snapshot.isOpen && previousScope.current.isOpen && previousScope.current.key !== scopeStackKey) {
      input.current?.focus();
    }

    previousScope.current = { isOpen: snapshot.isOpen, key: scopeStackKey };
  }, [scopeStackKey, snapshot.isOpen, input]);
  useEffect(() => {
    if (snapshot.selectedKey) {
      document.getElementById(`${config.listId}-item-${snapshot.selectedKey}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [snapshot.selectedKey, config.listId]);
  const [scopeSelectionContext, setScopeSelectionContext] = useState({ query: snapshot.query, scopeStackKey, isOpen: snapshot.isOpen });
  if (scopeSelectionContext.query !== snapshot.query || scopeSelectionContext.scopeStackKey !== scopeStackKey
    || scopeSelectionContext.isOpen !== snapshot.isOpen) {
    setScopeSelectionContext({ query: snapshot.query, scopeStackKey, isOpen: snapshot.isOpen });
    setSelectedScope(undefined);
  }

  function removeScope(index: number) {
    setSelectedScope(undefined);
    controller?.removeScope(index);
    input.current?.focus();
  }

  function handleInputKey(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) {
      event.stopPropagation();
      return;
    }

    if (isComposing(event)) {
      event.stopPropagation();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      // Keep native caret and text-selection behavior out of CommandList's handler.
      event.stopPropagation();
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey) {
      // Cmd/Ctrl+Enter opens a "New <plugin> tab" row in a background tab.
      if (event.key === 'Enter' && !event.altKey && !snapshot.searchPending && selectedScopeIndex < 0 && eligibleRow?.opensNewTab) {
        event.preventDefault();
        event.stopPropagation();
        void controller?.activate(eligibleRow.key, dispositionFor(event));
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
        event.stopPropagation();
      }

      // Global shortcuts such as Cmd/Ctrl-K still belong to the host listener.
      return;
    }

    if (snapshot.searchPending && (['Enter', 'ArrowUp', 'ArrowDown'].includes(event.key) || (event.key === 'Tab' && !event.shiftKey))) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.key === 'Tab' && !event.shiftKey && scopeableRow && controller?.scope(scopeableRow.key)) {
      event.preventDefault();
      event.stopPropagation();
      setSelectedScope(undefined);
      input.current?.focus();
      return;
    }

    if (event.key === 'Backspace' && snapshot.query === '' && snapshot.scopes.length) {
      event.preventDefault();
      event.stopPropagation();
      // Holding Backspace must not turn chip selection into accidental removal.
      if (event.repeat) {
        return;
      }

      if (selectedScopeIndex >= 0) {
        removeScope(selectedScopeIndex);
      } else {
        setSelectedScope(scopeKey(snapshot.scopes[snapshot.scopes.length - 1]));
      }

      return;
    }

    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.shiftKey) {
      const atStart = input.current?.selectionStart === 0 && input.current.selectionEnd === 0;
      if (selectedScopeIndex >= 0 || (event.key === 'ArrowLeft' && atStart && snapshot.scopes.length)) {
        event.preventDefault();
        event.stopPropagation();
        const index = selectedScopeIndex < 0 ? snapshot.scopes.length - 1
          : selectedScopeIndex + (event.key === 'ArrowLeft' ? -1 : 1);
        setSelectedScope(index >= snapshot.scopes.length ? undefined : scopeKey(snapshot.scopes[Math.max(0, index)]));
        return;
      }
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setSelectedScope(undefined);
      const rows = snapshot.rows.filter((row) => !isDisabled(row, snapshot.executionPending, snapshot.searchPending));
      const index = rows.findIndex((row) => row.key === snapshot.selectedKey);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next = index < 0 ? (direction === 1 ? 0 : rows.length - 1) : (index + direction + rows.length) % rows.length;
      if (rows[next]) {
        controller?.setSelectedKey(rows[next].key);
      }

      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (selectedScopeIndex < 0 && eligibleRow) {
        void controller?.activate(eligibleRow.key, eligibleRow.opensNewTab ? dispositionFor(event) : undefined);
      }

      return;
    }

    if (event.key !== 'Tab') {
      setSelectedScope(undefined);
    }
  }

  return (
    <>
      <div className={styles.QueryBar} onKeyDownCapture={(event) => {
        if (event.target === input.current) {
          handleInputKey(event);
        }
      }}>
        {snapshot.scopes.length > 0 && (
          <div className={styles.Scopes} role='group' aria-label='Search scopes'>
            {snapshot.scopes.map((scope, index) => {
              const key = scopeKey(scope);
              return (
                <Chip
                  as='span'
                  key={key}
                  className={styles.ScopeToken}
                  data-selected={selectedScope === key}
                  size='sm'
                  variant='soft'
                  color={scope.kind === 'connection' ? 'brand' : scope.kind === 'resource-type' ? 'info' : 'discovery'}
                  startDecorator={<ScopeIcon scope={scope} pluginIcons={pluginIcons} />}
                  endDecorator={<IconButton size='sm' variant='ghost' className={styles.RemoveScope}
                    aria-label={`Remove ${scopeLabels[scope.kind].toLowerCase()} scope ${scope.label}${index < snapshot.scopes.length - 1 ? ' and dependent scopes' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation(); removeScope(index); 
                    }}>
                    <LuX size={12} aria-hidden='true' />
                  </IconButton>}
                >
                  <Button size='sm' variant='ghost' className={styles.ScopeLabel}
                    style={{ minBlockSize: 0, blockSize: 'auto', padding: 0 }}
                    aria-label={scopeDescription(scope)} aria-pressed={selectedScope === key}
                    onClick={() => {
                      setSelectedScope(key); input.current?.focus(); 
                    }}>
                    {scope.label}
                    {scope.kind === 'resource' && scopeDetails(scope) && <span> · {scopeDetails(scope)}</span>}
                  </Button>
                </Chip>
              );
            })}
          </div>
        )}
        <BaseSearchInput
          ref={input}
          className={styles.QueryInput}
          autoFocus={false}
          value={snapshot.query}
          onValueChange={(query) => controller?.setQuery(query)}
          clearable
          placeholder='Search anything…'
          aria-controls={`${config.listId}-results`}
          aria-autocomplete='list'
          role='combobox'
          aria-label='Search Omniview'
          aria-expanded='true'
          aria-haspopup='listbox'
          aria-describedby={descriptionId}
          aria-activedescendant={selectedScopeIndex < 0 && selectedRow ? `${config.listId}-item-${selectedRow.key}` : undefined}
          onClick={() => {
            setSelectedScope(undefined); 
          }}
        />
      </div>
      <p id={descriptionId} className={styles.VisuallyHidden} role='status' aria-live='polite'>
        {selectedScopeIndex >= 0
          ? `${scopeDescription(snapshot.scopes[selectedScopeIndex])} selected. Backspace removes this scope and dependent scopes. Left and right select scopes.`
          : `${snapshot.scopes.length ? `${snapshot.scopes.map(scopeDescription).join('; ')}. ` : 'Searching all sources. '}Enter opens a result. Tab explores an eligible result. Empty-input Backspace selects the last scope.`}
      </p>
      <CommandList.Results className={styles.Results} />
    </>
  );
}

type PaletteProps = {
  controller: GlobalSearchController | null;
  snapshot: SearchSnapshot;
  input: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  catalogueMessage?: string;
  contexts?: readonly SearchProviderContextRegistration[];
  pluginIcons?: ReadonlyMap<string, string>;
  liveUpdateError?: string;
  retryLiveUpdates?: () => void;
};

export function GlobalCommandSearch({ controller, snapshot, input, onClose, catalogueMessage, contexts, pluginIcons, liveUpdateError, retryLiveUpdates }: PaletteProps) {
  const surface = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const dismissed = useRef(false);
  const pointerMotion = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // CommandList reports a click as an action without its event; keep the modifier keys of the click.
  const clickModifiers = useRef<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean } | null>(null);
  const selectedOpensNewTab = snapshot.rows.some((row) => row.key === snapshot.selectedKey && row.opensNewTab);
  function dismiss() {
    dismissed.current = true;
    onClose();
  }

  function isTopmost() {
    const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
    return dialogs[dialogs.length - 1] === surface.current;
  }

  useLayoutEffect(() => {
    if (snapshot.isOpen) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [snapshot.isOpen]);
  useEffect(() => {
    if (!snapshot.isOpen) {
      return;
    }

    dismissed.current = false;
    input.current?.focus();
    const overlay = surface.current?.parentElement;
    const background = Array.from(document.body.children).filter((node) => node !== overlay);
    const previous = background.map((node) => [node, node.hasAttribute('inert')] as const);
    background.forEach((node) => {
      node.setAttribute('inert', ''); 
    });
    function retainFocus(event: FocusEvent) {
      if (isTopmost() && event.target instanceof Node && !surface.current?.contains(event.target)) {
        input.current?.focus();
      }
    }

    document.addEventListener('focusin', retainFocus);
    return () => {
      document.removeEventListener('focusin', retainFocus);
      previous.forEach(([node, wasInert]) => {
        if (!wasInert) {
          node.removeAttribute('inert');
        } 
      });
      if (dismissed.current && opener.current?.isConnected) {
        opener.current.focus();
      }
    };
  }, [snapshot.isOpen, input]);
  const disabledKeys = useMemo(
    () => snapshot.rows.filter((row) => isDisabled(row, snapshot.executionPending, snapshot.searchPending)).map(rowKey),
    [snapshot.rows, snapshot.executionPending, snapshot.searchPending],
  );
  const loading = snapshot.searchPending || snapshot.sources.some((source) => source.state === 'queued' || source.state === 'pending');
  const [previousExploreHint, setPreviousExploreHint] = useState(false);
  const selectedCanExplore = snapshot.rows.some((row) => row.key === snapshot.selectedKey
    && !isDisabled(row, snapshot.executionPending)
    && supportsScope(row.value.scope, snapshot.scopes.at(-1)));
  if (!snapshot.searchPending && previousExploreHint !== selectedCanExplore) {
    setPreviousExploreHint(selectedCanExplore);
  }

  const canExplore = snapshot.searchPending ? previousExploreHint : selectedCanExplore;
  const statusSources = snapshot.sources.filter((source) => !['queued', 'pending', 'complete'].includes(source.state));

  function containFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || isComposing(event)) {
      event.stopPropagation();
      return;
    }

    if (!isTopmost()) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const targets = surface.current?.querySelectorAll<HTMLElement>(
      'button, summary, input, select, textarea, a[href], [tabindex]',
    );
    const focusable = targets ? Array.from(targets).filter((target) =>
      target.tabIndex >= 0 && !target.matches(':disabled') &&
      !target.closest('[hidden], [aria-hidden="true"], [inert], details:not([open]) > :not(summary)'),
    ) : [];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) {
      event.preventDefault();
      surface.current?.focus();
    } else if (event.shiftKey && (document.activeElement === first || !surface.current?.contains(document.activeElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !surface.current?.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      {contexts && <SearchProviderContexts contexts={contexts} controller={controller} />}
      <Dialog ref={surface} open={snapshot.isOpen} onClose={() => {
        if (isTopmost()) {
          dismiss();
        } 
      }} size='lg'
      onKeyDown={containFocus} onKeyDownCapture={(event) => {
        if (isComposing(event) || event.defaultPrevented) {
          event.stopPropagation();
        }
      }}>
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
            itemKey={rowKey}
            getTextValue={rowLabel}
            query={snapshot.query}
            onQueryChange={(query) => controller?.setQuery(query)}
            filterFn={includeRankedRow}
            sortByScore={false}
            virtualized={false}
            disabledKeys={disabledKeys}
            loading={loading}
            aria-busy={loading || snapshot.executionPending || undefined}
            placeholder='Search anything…'
            onAction={(key) => {
              const modifiers = clickModifiers.current;
              clickModifiers.current = null;
              const opensNewTab = snapshot.rows.some((row) => row.key === String(key) && row.opensNewTab);
              void controller?.activate(String(key), opensNewTab && modifiers ? dispositionFor(modifiers) : undefined);
            }}
            onDismiss={dismiss}
            onKeyDownCapture={(event) => {
              if (event.target !== input.current && ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                event.stopPropagation();
              }
            }}
            onKeyDown={(event) => {
              if (event.defaultPrevented) {
                event.stopPropagation();
              } 
            }}
            onMouseMoveCapture={(event) => {
              const previous = pointerMotion.current;
              pointerMotion.current = {
                x: event.clientX,
                y: event.clientY,
                moved: previous !== null && (previous.x !== event.clientX || previous.y !== event.clientY),
              };
            }}
            renderItem={(row) => {
              const Icon = kindIcons[row.value.kind];
              const breadcrumb = getSettingBreadcrumb(row);
              const resultScope = row.value.kind === 'action' ? row.value.action.target : row.value.scope;
              const resourceDetails = !row.value.description && !breadcrumb && resultScope?.kind === 'resource' ? scopeDetails(resultScope) : undefined;
              return (
                <CommandList.Item
                  itemKey={row.key}
                  disabled={isDisabled(row, snapshot.executionPending, snapshot.searchPending)}
                  aria-selected={snapshot.selectedKey === row.key || undefined}
                  data-ov-active={snapshot.selectedKey === row.key}
                  title={resultScope ? scopeDescription(resultScope) : undefined}
                  onClickCapture={(event) => {
                    clickModifiers.current = { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
                  }}
                  onMouseMove={() => {
                    if (pointerMotion.current?.moved && !isDisabled(row, snapshot.executionPending, snapshot.searchPending) && snapshot.selectedKey !== row.key) {
                      controller?.setSelectedKey(row.key);
                    }
                  }}
                >
                  <CommandList.ItemIcon aria-hidden='true'>
                    {row.opensNewTab ? <NewTabIcon row={row} pluginIcons={pluginIcons} />
                      : resultScope ? <ScopeIcon scope={resultScope} pluginIcons={pluginIcons} /> : <Icon />}
                  </CommandList.ItemIcon>
                  <CommandList.ItemContent className={styles.ResultContent}>
                    <CommandList.ItemLabel>{row.label}</CommandList.ItemLabel>
                    {breadcrumb && <CommandList.ItemMeta>{breadcrumb}</CommandList.ItemMeta>}
                    {!row.value.description && !breadcrumb && <CommandList.ItemMeta>
                      {resultScope?.kind === 'resource' ? (resourceDetails === '' ? undefined : resourceDetails)
                        : resultScope?.kind === 'resource-type' ? resultScope.target.type
                          : resultScope?.kind === 'connection' ? resultScope.pluginId
                            : row.opensNewTab ? 'New tab' : kindLabels[row.value.kind]}
                    </CommandList.ItemMeta>}
                    {row.value.description && <CommandList.ItemDescription>{row.value.description}</CommandList.ItemDescription>}
                    {row.disabledReason && <CommandList.ItemDisabledReason>{row.disabledReason}</CommandList.ItemDisabledReason>}
                  </CommandList.ItemContent>
                  {!isDisabled(row, snapshot.executionPending) && supportsScope(row.value.scope, snapshot.scopes.at(-1)) && (
                    <IconButton
                      size='sm'
                      variant='ghost'
                      disabled={snapshot.searchPending}
                      className={styles.ScopeControl}
                      aria-label={`Scope to ${row.label}`}
                      onMouseDown={(event) => {
                        event.preventDefault(); 
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        controller?.setSelectedKey(row.key);
                        if (controller?.scope(row.key)) {
                          input.current?.focus();
                        }
                      }}
                    ><LuChevronRight size={14} aria-hidden='true' /></IconButton>
                  )}
                </CommandList.Item>
              );
            }}
          >
            <SearchInput controller={controller} snapshot={snapshot} input={input} onClose={dismiss} pluginIcons={pluginIcons} />
            {snapshot.rows.length === 0 && <div className={styles.EmptyState}>
              <CommandList.Empty>
                {statusSources.length ? 'No results. Review source status.' : 'No matching results.'}
              </CommandList.Empty>
              <CommandList.Loading>Searching…</CommandList.Loading>
            </div>}
          </CommandList>
          {liveUpdateError && <Banner color='warning' variant='soft' size='sm' role='status' aria-live='polite'>
            <Banner.Content>{liveUpdateError}</Banner.Content>
            {retryLiveUpdates && <Button size='sm' variant='ghost' disabled={snapshot.executionPending}
              onClick={() => {
                retryLiveUpdates(); input.current?.focus(); 
              }}>Retry live updates</Button>}
          </Banner>}
          <div className={styles.StatusRail} role='status' aria-live='polite' aria-label='Search availability'>
            <div className={styles.StatusIndicators}>
              {loading ? <span className={styles.StatusIndicator}><LuLoaderCircle className={styles.StatusSpinner} aria-hidden='true' />Searching</span>
                : statusSources.length ? statusSources.map((source) => {
                  const visual = sourceVisuals[source.state];
                  return <span className={styles.StatusItem} key={source.id}>
                    <Chip size='sm' variant='soft' color={visual.color}
                      title={`${source.label}: ${source.message ?? visual.label}`}
                      aria-label={`${source.label}: ${visual.label}`} startDecorator={<visual.Icon aria-hidden='true' />}>
                      {visual.label}
                    </Chip>
                    {source.retryable && <IconButton size='sm' variant='ghost' disabled={snapshot.executionPending}
                      aria-label={`Retry ${source.label}`} onClick={() => {
                        controller?.retrySource(source.id); input.current?.focus(); 
                      }}>
                      <LuRefreshCw size={14} aria-hidden='true' />
                    </IconButton>}
                  </span>;
                }) : <span className={styles.StatusIndicator}><LuCircleCheck aria-hidden='true' />Ready</span>}
              {(Boolean(snapshot.message) || Boolean(catalogueMessage)) && <Chip size='sm' variant='soft' color='warning'
                title={[snapshot.message, catalogueMessage].filter(Boolean).join(' ')}
                startDecorator={<LuTriangleAlert aria-hidden='true' />}>Search notice</Chip>}
            </div>
            <details className={styles.SourceDetails}>
              <summary aria-label='Search source details'><LuInfo aria-hidden='true' />Details</summary>
              <ul className={styles.Sources} aria-label='Search source status'>
                {snapshot.message && <li>{snapshot.message}</li>}
                {catalogueMessage && <li>{catalogueMessage}</li>}
                {snapshot.sources.map((source) => <li key={source.id}>
                  <strong>{source.label}: {getSourceStatusLabel(source.state)}</strong>
                  {source.message && <span>{source.message}</span>}
                </li>)}
              </ul>
            </details>
          </div>
          {snapshot.feedback && <p role='status' aria-live='polite'>
            {snapshot.feedback.message}
            {snapshot.feedback.code && ` (${snapshot.feedback.code})`}
            {snapshot.feedback.requestId && ` Request: ${snapshot.feedback.requestId}`}
          </p>}
        </Dialog.Body>
        <Dialog.Footer>
          <div className={styles.KeyboardHints} aria-label='Keyboard shortcuts'>
            <span><Hotkey>↑</Hotkey><Hotkey>↓</Hotkey> Navigate</span>
            <span><Hotkey>Enter</Hotkey> Open</span>
            {selectedOpensNewTab && <span><Hotkey keys={[MOD_KEY, 'Enter']} /> Background tab</span>}
            {selectedOpensNewTab && <span><Hotkey keys={['Shift', 'Enter']} /> New window</span>}
            {canExplore && <span><Hotkey>Tab</Hotkey> Explore</span>}
            <span><Hotkey>Esc</Hotkey> Close</span>
          </div>
        </Dialog.Footer>
      </Dialog>
    </>
  );
}
