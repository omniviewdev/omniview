// The text a schema or a host carries comes from a plugin: it is cleaned and bounded before anything shows it (the host does the same on the Go side: `apperror.PublicText`, E0-1), and a
// text that is shown never carries a secret the user typed (`scrubber`).

/** A terminal escape: CSI, OSC and the two-character ones. Removed whole, so no "[31m" is left behind. */
const ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Control, format (bidi, zero width, tag), private-use and lone surrogate characters. */
const DROPPED = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu;

const REPLACEMENT = '•••';

/** The text cut to `max` characters (code points, never half a pair), with an ellipsis in the last place. */
export function clip(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

/** A plugin's or a host's text made fit to show: escapes and control characters removed, white space collapsed, trimmed, bounded. Anything that is not a text is an empty one. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }

  // Cleaning only removes, so the head of a very long text is enough to fill the bound.
  const head = value.length > max * 4 + 64 ? value.slice(0, max * 4 + 64) : value;
  return clip(plain(head), max);
}

/** A text with escapes and control characters removed and white space collapsed, not bounded. */
const plain = (value: string): string => value.replace(ESCAPES, '').replace(/\s+/g, ' ').replace(DROPPED, '').replace(/ {2,}/g, ' ').trim();

const escapeForPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function replaceSecret(text: string, secret: string): string {
  return secret.length >= 3 ? text.split(secret).join(REPLACEMENT) : text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeForPattern(secret)}(?![\\p{L}\\p{N}])`, 'gu'), REPLACEMENT);
}

/**
 * Replaces every occurrence of a secret in a text. `secrets` is asked at each call, so a secret typed after the scrubber was made is covered. A secret of three characters or more is
 * replaced wherever it occurs; a shorter one only as a word (it would garble every message, and it is still never shown). A secret is looked for as it was typed and as cleaning would
 * show it (a secret with a line break in it is echoed, cleaned, with a space). A host that echoes a transformed secret (base64, cut) is not caught: the model cannot know the transform.
 */
export function scrubber(secrets: () => Iterable<string>): (text: string) => string {
  return (text) => {
    let out = text;
    for (const secret of secrets()) {
      if (secret === '') {
        continue;
      }

      out = replaceSecret(out, secret);
      const cleaned = plain(secret);
      if (cleaned !== '' && cleaned !== secret) {
        out = replaceSecret(out, cleaned);
      }
    }

    return out;
  };
}
