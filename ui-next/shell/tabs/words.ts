import type { StripItem, TabId } from '../core/tabs';

// The words a tab is read and described with. The model's identity is the one answer for what a tab is called (core/tabs/identity.ts: label, accessible name, tooltip); what the strip
// adds are the words of the flags (ch16 S17 to S25), so a state is never only a colour or a glyph.

/** The words of a tab's flags, in the order the mock says them. */
function stateWords(item: StripItem): readonly string[] {
  return [item.attention === false ? '' : 'needs attention', item.unsaved ? 'unsaved changes' : '', item.pinned ? 'pinned' : '', item.preview ? 'preview' : ''].filter((word) => word !== '');
}

/** The tab's accessible name: the identity's name (title, then scope and qualifier), then the flags. It contains the text the tab draws (WCAG 2.5.3). */
export function tabName(item: StripItem): string {
  return [item.identity.name, ...stateWords(item)].join(', ');
}

/** The tab's tooltip: `Plugin › Scope › Path` (the title when a page has no path), then one line per flag, capitalised (ch16 S17). */
export function tabTip(item: StripItem): string {
  const lines = stateWords(item).map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  return [item.identity.tip === '' ? item.identity.title : item.identity.tip, ...lines].join('\n');
}

/** The id of a tab's DOM element: the strip, the panel's label and the focus all name a tab by it. `prefix` is the shell's own (`useId`). */
export function tabDomId(prefix: string, id: TabId): string {
  return `${prefix}-${id}`;
}
