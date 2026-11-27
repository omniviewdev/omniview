import { useEffect, useId, useRef, useState, type MouseEvent, type Ref } from 'react';
import { IconButton, SearchField } from '@omniviewdev/kit';
import { guidance } from '../content/catalog';

export const componentHref = (part: string) => `?component=${encodeURIComponent(part)}`;

type FinderProps = {
  parts: string[];
  part: string | undefined;
  onSelect: (name: string) => void;
};

function Finder({ parts, part, onSelect }: FinderProps) {
  const [query, setQuery] = useState('');
  const groupId = useId();
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const groups = new Map<string, string[]>();
  let matchCount = 0;
  for (const name of parts) {
    const category = guidance[name].category;
    let matches = groups.get(category);
    if (!matches) groups.set(category, matches = []);
    const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const categoryKey = category.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!terms.every((term) => nameKey.includes(term) || categoryKey.includes(term))) continue;
    matches.push(name);
    matchCount++;
  }

  function select(event: MouseEvent<HTMLAnchorElement>, name: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    onSelect(name);
  }

  return (
    <nav className="library-finder" aria-label="Components">
      <SearchField label="Search components" value={query} placeholder="Name or category" onValueChange={setQuery} />
      <p className="inline-status library-finder-status" role="status">
        {parts.length > 0 && (matchCount === 0 ? 'No matching components.' : terms.length > 0 ? `${matchCount} found` : '')}
      </p>
      <div className="library-finder-results">
        {Array.from(groups).map(([category, matches], index) => matches.length > 0 && (
          <div className="library-finder-group" key={category}>
            <h2 className="eyebrow" id={`${groupId}-${index}`}>{category}</h2>
            <ul className="library-finder-links" aria-labelledby={`${groupId}-${index}`} role="list">
              {matches.map((name) => <li key={name}>
                <a href={componentHref(name)} aria-current={part === name ? 'page' : undefined} onClick={(event) => select(event, name)}>{name}</a>
              </li>)}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

export function ComponentRail({ railRef, ...props }: FinderProps & { railRef: Ref<HTMLElement> }) {
  return <aside ref={railRef} className="library-rail"><Finder {...props} /></aside>;
}

export function LibraryFinder({ rail, onSelect, ...props }: FinderProps & { rail: { readonly current: HTMLElement | null } }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogId = useId();

  function showFinder() {
    const modal = dialog.current;
    if (!modal) return;
    if (!modal.open) modal.showModal();
    modal.querySelector('input')?.focus();
  }

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey
        || event.metaKey === event.ctrlKey || event.key.toLowerCase() !== 'k') return;
      if (event.composedPath().some((node) => node instanceof HTMLElement && (
        node.isContentEditable || node.matches('input, textarea, select, [role="textbox"]')
      ))) return;
      event.preventDefault();
      if (rail.current?.getClientRects().length && !dialog.current?.open) {
        rail.current.querySelector('input')?.focus();
      } else {
        showFinder();
      }
    }
    function closeFinder() {
      dialog.current?.close();
    }
    window.addEventListener('keydown', shortcut);
    window.addEventListener('popstate', closeFinder);
    return () => {
      window.removeEventListener('keydown', shortcut);
      window.removeEventListener('popstate', closeFinder);
    };
  }, [rail]);

  return (
    <>
      <span className="library-finder-trigger">
        <IconButton icon="search" label="Find components" variant="ghost" onClick={(event) => {
          event.currentTarget.focus();
          showFinder();
        }} />
      </span>
      <dialog className="library-finder-dialog" ref={dialog} aria-labelledby={dialogId}>
        <div className="library-finder-drawer">
          <header className="library-finder-heading">
            <h2 id={dialogId}>Find components</h2>
            <IconButton icon="close" label="Close component finder" variant="ghost" onClick={() => dialog.current?.close()} />
          </header>
          <Finder {...props} onSelect={(name) => {
            dialog.current?.close();
            onSelect(name);
          }} />
        </div>
      </dialog>
    </>
  );
}
