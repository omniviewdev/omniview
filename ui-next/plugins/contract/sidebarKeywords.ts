// Admission of the keywords a sidebar node carries (C1e). A node is plugin data, and so is every answer of the sidebar's data hook, which the host reads again whenever the palette asks for the pages it can go to:
// the keywords are read once, word by word, into a clean list or a problem that names the node and the rule it broke. Nothing here throws on what a plugin hands over, and a keyword that is not valid costs the node
// that keyword and no other: never the node, the sidebar or the plugin. Pure: no React, no registry, no I/O. A keyword is a name the page is also known by (`ws` for Workshops); `host/palette.ts` hands the words to
// the palette, which ranks a page by one as it ranks it by its title (`shell/core/palette/match.ts`).

/** The bounds, in characters unless said otherwise. At most `count` words are kept, and `scan` entries are looked at, whatever the list holds: the rest were never read. */
export const SIDEBAR_KEYWORD_LIMITS = Object.freeze({ count: 8, length: 32, scan: 32 });

/** The longest id a problem repeats: the id is the plugin's, and a log line is read by a person. */
const MAX_ID = 64;
/** Text longer than this is not looked into, whatever the field: a bound on the work, before the bound on the word. */
const MAX_RAW = 256;
/** The problems said for keywords that are not valid: this many lines, the last of them a count of the rest. */
const MAX_PROBLEMS = 4;

export type KeywordsRead = {
  /** The words kept, in the plugin's order, each once whatever its case: at most `SIDEBAR_KEYWORD_LIMITS.count`. */
  readonly words: readonly string[];
  /** What was left out and why, in the plugin author's words. Empty when nothing was. */
  readonly problems: readonly string[];
};

const NONE: KeywordsRead = Object.freeze({ words: Object.freeze([]), problems: Object.freeze([]) });

/** What a node is read for: both members are `unknown` until this module has read them. */
type Fields = { readonly id?: unknown; readonly keywords?: unknown };

/** How a problem names the node: by its id when it has one a log can use. An id that cannot be read is no id: the plugin's own accessor may throw, and this reader never does. */
function nameOf(fields: Fields): string {
  try {
    const { id } = fields;
    return typeof id === 'string' && id !== '' ? `sidebar entry "${id.slice(0, MAX_ID)}"` : 'a sidebar entry';
  } catch {
    return 'a sidebar entry';
  }
}

/** One keyword read: a word of 1 to `length` characters with no white space in it, trimmed. `undefined` when it is not one. */
function wordOf(entry: unknown): string | undefined {
  if (typeof entry !== 'string' || entry.length > MAX_RAW) {
    return undefined;
  }

  const word = entry.trim();
  return word === '' || word.length > SIDEBAR_KEYWORD_LIMITS.length || /\s/.test(word) ? undefined : word;
}

const refused = (problem: string): KeywordsRead => Object.freeze({ words: Object.freeze([]), problems: Object.freeze([problem]) });

/**
 * The keywords of a sidebar node. A node that has none (an older plugin) and anything that is not an object, which is the sidebar's problem and not the keywords', read as no words and no problem. Words are kept in the
 * plugin's order, each once whatever its case (the same name said twice is not a problem); an entry that is not a word is left out with a problem naming its place (its number in the list, from 1), in at most
 * `MAX_PROBLEMS` lines; words past the count are left out from the next one on, with a problem of their own; and a list that cannot be read is no words and one problem.
 */
export function readKeywords(node: unknown): KeywordsRead {
  if (typeof node !== 'object' || node === null) {
    return NONE;
  }

  const fields = node as Fields;
  const at = nameOf(fields);
  try {
    // Read once: a getter that answers differently the second time is not what was checked.
    const raw = fields.keywords;
    if (raw === undefined) {
      return NONE;
    }

    if (!Array.isArray(raw)) {
      return refused(`${at}: keywords is not a list of words: it is left out`);
    }

    const words: string[] = [];
    const seen = new Set<string>();
    const bad: string[] = [];
    let wrong = 0;
    let over = false;
    const looked = Math.min(raw.length, SIDEBAR_KEYWORD_LIMITS.scan);
    for (let index = 0; index < looked && !over; index += 1) {
      const word = wordOf(raw[index]);
      if (word === undefined) {
        wrong += 1;
        if (bad.length < MAX_PROBLEMS - 1) {
          bad.push(`${at}: keyword ${String(index + 1)} is not a word of 1 to ${String(SIDEBAR_KEYWORD_LIMITS.length)} characters, with no white space in it: it is left out`);
        }

        continue;
      }

      const key = word.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      if (words.length === SIDEBAR_KEYWORD_LIMITS.count) {
        over = true;
        continue;
      }

      seen.add(key);
      words.push(word);
    }

    // A list longer than the scan was not read to its end: its rest is left out, as the words past the count are.
    over ||= raw.length > looked;
    const problems = wrong > bad.length ? [...bad, `and ${String(wrong - bad.length)} more keywords that are not valid`] : bad;
    if (over) {
      problems.push(`${at}: more than ${String(SIDEBAR_KEYWORD_LIMITS.count)} keywords: the rest are left out`);
    }

    return Object.freeze({ words: Object.freeze(words), problems: Object.freeze(problems) });
  } catch {
    // The plugin's own accessor threw, or its list did when it was read: no word of it is taken.
    return refused(`${at}: keywords could not be read: it is left out`);
  }
}
