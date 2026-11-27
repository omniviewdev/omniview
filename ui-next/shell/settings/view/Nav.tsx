import { Icon, isIconName, RovingGroup, SearchField, Text, type IconName } from '@omniviewdev/kit';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { press, stopOf, toggled, visibleRows } from '../../core/tree';
import type { PageView } from './Page';
import { kitGlyphOf } from './glyph';
import styles from './Nav.module.css';

/** Inventory progress and retry actions are not pages and never become search hits. */
export type NavNotice = { readonly id: string; readonly label: string; readonly retry?: () => void };

type NavProps = {
  readonly pages: readonly PageView[];
  readonly selected: string | undefined;
  readonly notices: readonly NavNotice[];
  readonly onSelect: (id: string) => void;
  readonly onResult: (id: string, field: string | undefined) => void;
};

type Item = {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName | undefined;
  readonly page?: PageView;
  readonly retry?: () => void;
  readonly children?: readonly Item[];
};

const BRANCHES = { core: 'Core', plugins: 'Plugins' } as const;
const BOTH: ReadonlySet<string> = new Set(Object.keys(BRANCHES));
const pageKey = (id: string) => `page:${id}`;

function branchesOf(pages: readonly PageView[], notices: readonly NavNotice[]): readonly Item[] {
  const core: Item[] = [];
  const plugins: Item[] = [];
  for (const page of pages) {
    const icon = isIconName(page.icon) ? page.icon : kitGlyphOf(page.icon) ?? (page.branch === 'plugins' ? 'package' : undefined);
    (page.branch === 'core' ? core : plugins).push({ id: pageKey(page.id), label: page.title, icon, page });
  }

  plugins.push(...notices);
  if (core.length === 0) {
    core.push({ id: 'empty:core', label: 'No core settings available.' });
  }

  if (plugins.length === 0) {
    plugins.push({ id: 'empty:plugins', label: 'No plugin settings available.' });
  }

  return [
    { id: 'core', label: BRANCHES.core, icon: 'settings', children: core },
    { id: 'plugins', label: BRANCHES.plugins, icon: 'puzzle', children: plugins },
  ];
}

type Hit = { readonly page: PageView; readonly title: string; readonly field?: string };

/** Only names the form actually displays are searchable. Never index values, including secret drafts. */
function matches(pages: readonly PageView[], needle: string): readonly Hit[] {
  const hits: Hit[] = [];
  if (needle !== '') {
    for (const page of pages) {
      if (page.title.toLowerCase().includes(needle)) {
        hits.push({ page, title: page.title });
      }

      for (const id of page.fields) {
        const field = page.form.field(id);
        if (field?.visible && field.label.toLowerCase().includes(needle)) {
          hits.push({ page, title: field.label, field: id });
        }
      }
    }
  }

  return hits;
}

/** The search stays fixed above the scrollable tree. Browsing follows focus; search previews nothing until a result is chosen. */
export function Nav({ pages, selected, notices, onSelect, onResult }: NavProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(BOTH);
  const [lastStop, setLastStop] = useState<string>();
  const [shown, setShown] = useState(selected);
  // A disappearing plugin can select a different page. Reveal its branch once; a deliberate collapse then stays closed.
  if (shown !== selected) {
    setShown(selected);
    const branch = pages.find(page => page.id === selected)?.branch;
    if (branch && !open.has(branch)) {
      setOpen(toggled(open, branch, true));
    }
  }

  const nav = useRef<HTMLElement>(null);
  const needle = query.trim().toLowerCase();
  const hits = useMemo(() => matches(pages, needle), [pages, needle]);
  const nodes = useMemo(() => branchesOf(pages, notices), [pages, notices]);
  const rows = useMemo(() => visibleRows(nodes, open), [nodes, open]);
  const stop = stopOf(rows, lastStop, selected === undefined ? undefined : pageKey(selected));

  const choose = (hit: Hit) => {
    setOpen(before => toggled(before, hit.page.branch, true));
    setLastStop(pageKey(hit.page.id));
    setQuery('');
    onResult(hit.page.id, hit.field);
  };

  const activate = (item: Item) => {
    if (item.children) {
      setOpen(before => toggled(before, item.id));
    } else if (item.page) {
      onSelect(item.page.id);
    } else if (item.retry) {
      // Retrying removes the action. Keep keyboard focus on its parent branch.
      nav.current?.querySelector<HTMLElement>('[data-settings-branch="plugins"]')?.focus();
      item.retry();
    }
  };

  const onTreeKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const next = press(rows, open, stop, event.key);
    if (!next.handled) {
      return;
    }

    event.preventDefault();
    setOpen(next.open);
    if (next.activate !== undefined) {
      const row = rows.find(item => item.id === next.activate);
      if (row) {
        activate(row.node);
      }
    }

    if (next.stop !== stop) {
      const index = rows.findIndex(row => row.id === next.stop);
      const target = event.currentTarget.children.item(index);
      if (target instanceof HTMLElement) {
        target.focus();
      }
    }
  };

  const onSearchKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && hits[0]) {
      // Choosing a result can focus an editor. Do not let this Enter type into its new target.
      event.preventDefault();
      choose(hits[0]);
    } else if (event.key === 'ArrowDown' && event.target instanceof HTMLInputElement) {
      const first = nav.current?.querySelector<HTMLElement>(needle === '' ? '[role="treeitem"][tabindex="0"]' : '[data-settings-result-page]');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
      nav.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    }
  };

  return (
    <nav ref={nav} className={styles.nav} aria-label="Settings pages" data-settings-part="nav" onKeyDown={onSearchKey}>
      <div className={styles.search}>
        <SearchField
          label="Search settings"
          data-settings-part="search"
          value={query}
          onValueChange={setQuery}
        />
      </div>
      <div key={needle === '' ? 'browse' : 'search'} className={styles.scroll} data-settings-part="tree-scroll">
        {needle === '' ? (
          <ul className={styles.tree} role="tree" aria-label="Settings pages" data-settings-part="tree" onKeyDown={onTreeKey}>
            {rows.map(({ node, level, expandable, expanded, position, setSize }) => {
              const current = node.page !== undefined && node.page.id === selected;
              const note = !node.page && !expandable;
              return (
                <li
                  key={node.id}
                  role="treeitem"
                  className={styles.item}
                  tabIndex={node.id === stop ? 0 : -1}
                  aria-expanded={expandable ? expanded : undefined}
                  aria-selected={node.page ? current : undefined}
                  aria-current={current ? 'page' : undefined}
                  aria-disabled={note && !node.retry ? true : undefined}
                  aria-level={level}
                  aria-setsize={setSize}
                  aria-posinset={position}
                  data-settings-branch={expandable ? node.id : undefined}
                  data-settings-page={node.page?.id}
                  data-settings-notice={note || undefined}
                  onFocus={() => {
                    if (node.id !== stop) {
                      setLastStop(node.id);
                    }

                    if (node.page) {
                      onSelect(node.page.id);
                    }
                  }}
                  onClick={event => {
                    event.currentTarget.focus({ preventScroll: true });
                    activate(node);
                  }}
                >
                  {expandable ? <span className={styles.chevron}><Icon name={expanded ? 'chevron-down' : 'chevron-right'} /></span> : null}
                  {node.icon ? <span className={styles.glyph}><Icon name={node.icon} /></span> : null}
                  <span className={styles.label} data-settings-part="tree-label" data-ov-clip="">{node.label}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.results}>
            <p role="status" className={hits.length === 0 ? styles.empty : styles.live}>
              {hits.length === 0 ? (notices.length === 0 ? 'No matching settings.' : 'No matches on loaded pages.') : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`}
            </p>
            {hits.length > 0 ? (
              <RovingGroup label="Search results" kind="column">
                {hits.map(hit => (
                  <button
                    key={JSON.stringify([hit.page.id, hit.field])}
                    type="button"
                    className={styles.result}
                    data-settings-result-page={hit.page.id}
                    data-settings-result-field={hit.field}
                    onClick={() => {
                      choose(hit);
                    }}
                  >
                    <span data-ov-clip="">{hit.title}</span>
                    <Text variant="caption" tone="muted">{BRANCHES[hit.page.branch]}{hit.field === undefined ? '' : ` › ${hit.page.title}`}</Text>
                  </button>
                ))}
              </RovingGroup>
            ) : null}
            {notices.map(note => note.retry ? (
              <button key={note.id} type="button" className={styles.result} onClick={() => {
                nav.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
                note.retry?.();
              }}>{note.label}</button>
            ) : <p key={note.id} className={styles.empty} role="status">{note.label}</p>)}
          </div>
        )}
      </div>
    </nav>
  );
}
