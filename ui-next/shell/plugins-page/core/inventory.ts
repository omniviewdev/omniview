import type { Installed, InventoryEntry } from './types';

// What the page keeps of the host's inventory (`PluginManager.ListPlugins`). The inventory comes over the wire from Go, so a list that is empty may arrive as `null`; the text in it is the plugin's own (its manifest's name,
// description and author), so it is read as text and cut to what a row and a card can hold. The member that holds the text of the last error (`lastError`) is not read at all (`types.ts`).

/** How much of each member a row and a card can hold; a longer text is cut with an ellipsis, a longer list to its first members. */
export const BOUNDS = Object.freeze({ name: 80, version: 40, description: 280, publisher: 80, license: 40, category: 40, address: 300, tag: 32, tags: 12, dependency: 80, dependencies: 12, capability: 24, capabilities: 12 });

/** `text` as a trimmed line of at most `max` characters, with an ellipsis where it was cut; empty for what is not text. */
function bounded(text: unknown, max: number): string {
  if (typeof text !== 'string') {
    return '';
  }

  const line = text.trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** The words of a list that are text, bounded, without blanks and repeats, at most `count` of them: a list Go sent as `null` is empty. */
function wordsOf(list: unknown, max: number, count: number): readonly string[] {
  if (!Array.isArray(list)) {
    return [];
  }

  const words: string[] = [];
  for (const item of list as readonly unknown[]) {
    const word = bounded(item, max);
    if (word !== '' && !words.includes(word)) {
      words.push(word);
    }

    if (words.length === count) {
      break;
    }
  }

  return words;
}

/** A web address a manifest names, or nothing: a link that is not an http or https address, or has a blank in it, is no link. */
function addressOf(text: unknown): string {
  const address = bounded(text, BOUNDS.address);
  return /^https?:\/\/\S+$/i.test(address) ? address : '';
}

/** One inventory entry as the page keeps it. */
export function installedOf(entry: InventoryEntry): Installed {
  const { metadata } = entry;
  const name = bounded(metadata.name, BOUNDS.name);
  return {
    id: entry.id,
    name: name === '' ? entry.id : name,
    version: bounded(metadata.version, BOUNDS.version),
    description: bounded(metadata.description, BOUNDS.description),
    publisher: bounded(metadata.author?.name, BOUNDS.publisher),
    license: bounded(metadata.license, BOUNDS.license),
    category: bounded(metadata.category, BOUNDS.category),
    repository: addressOf(metadata.repository),
    website: addressOf(metadata.website),
    tags: wordsOf(metadata.tags, BOUNDS.tag, BOUNDS.tags),
    dependencies: wordsOf(metadata.dependencies, BOUNDS.dependency, BOUNDS.dependencies),
    capabilities: wordsOf(metadata.capabilities, BOUNDS.capability, BOUNDS.capabilities),
    builtin: entry.origin === 'builtin',
    enabled: entry.enabled,
    devMode: entry.devMode,
    releaseChannel: bounded(entry.releaseChannel, BOUNDS.name),
    phase: entry.phase,
  };
}

const text = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The list's order: by name, compared as plain text so that a machine's locale moves no plugin, and by id when two share a name. The same order as the rail's (`compareRail`). */
export function compareInstalled(a: Installed, b: Installed): number {
  return text(a.name.toLowerCase(), b.name.toLowerCase()) || text(a.name, b.name) || text(a.id, b.id);
}

/** The plugins the host lists, once each (the last it sent says what the plugin is now), in the order the page draws them. What is not a list is no plugins. */
export function listOf(entries: readonly InventoryEntry[]): readonly Installed[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const byId = new Map<string, Installed>();
  for (const entry of entries) {
    if (typeof entry.id === 'string' && entry.id !== '') {
      byId.set(entry.id, installedOf(entry));
    }
  }

  return [...byId.values()].sort(compareInstalled);
}
