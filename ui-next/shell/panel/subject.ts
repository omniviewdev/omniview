import type { ModifierEvent } from '../core/tabs';

// Where a row of Problems or Operations goes (ch16 S121: "Open {target}"): the thing the row is about. The tools know no address grammar and no tab disposition: the host opens a subject, by the open model's rules.

/** What a row is about: a plugin (its own page says what happened and offers the Retry) or one connection of a plugin (chosen the way Home and the picker choose one: started first, then opened). */
export type Subject = { readonly kind: 'plugin'; readonly plugin: string } | { readonly kind: 'connection'; readonly plugin: string; readonly connection: string };

/** Opens a subject. `event` is the click or the key that chose it: its modifiers pick the disposition (smart open, a background tab, a new tab); `undefined` is the plain one. */
export type OpenSubject = (subject: Subject, event: ModifierEvent | undefined) => void;
