// The host's words for the capability kinds a plugin declares (docs/ui-next/status/PL1.md, PL1-17): what the plugin PROVIDES, never what it may access, so the page says "Provides" and never "Permissions".

const WORDS: Readonly<Record<string, string>> = {
  ui: 'Pages',
  resource: 'Resources',
  exec: 'Shell access',
  networker: 'Port forwarding',
  log: 'Logs',
  metric: 'Metrics',
  settings: 'Settings',
  tools: 'Tools',
};

/** The word for one kind. A kind this version does not know is shown as its own text, capitalised, so a newer host's kind is said and never dropped. */
export function capabilityWord(kind: string): string {
  return Object.hasOwn(WORDS, kind) ? (WORDS[kind] ?? kind) : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}
