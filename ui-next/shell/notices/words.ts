import { isIconName, type IconName } from '@omniviewdev/kit';
import type { ActionView, RecordView, Severity } from '../core/notices';

// The words and glyphs of a toast (ch16 S79, S83, S86; the mock's `WORD`, `GLYPH`, `glyphOf` and `present`, shell-notify.js). The model makes the words of a record, once, for every surface (`RecordView`); what is
// here is the little that is the toast's own: the word a severity is read as, the glyph it is drawn with, the name of the control that dismisses it, and which of the record's actions a toast has room for.

/** Severity is a glyph and a word, never colour alone (S83). The glyph is for the eye and the word is what a screen reader reads, in the toast's name and ahead of its text. */
export const SEVERITY_WORD: Readonly<Record<Severity, string>> = { info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' };

/** The shipped status glyphs, used as they are and never recoloured (S83): the kit's registry resolves their paint from the theme's own roles. */
const STATUS_GLYPH: Readonly<Record<Severity, IconName>> = { info: 'status-info', success: 'status-success', warning: 'status-warning', error: 'status-error' };

export type Glyph = {
  readonly name: IconName;
  /** The loader that turns while the work runs (`spin`), or that stands while it waits (`idle`); absent for a status glyph. */
  readonly busy: 'spin' | 'idle' | undefined;
};

/**
 * The glyph of a record (the mock's X2): work under way is the loader (it turns while it runs and stands while it is queued or paused), canceled work the neutral minus in a circle, and everything else the
 * status glyph of its severity, which says what happened to a message and how a piece of work ended.
 */
export function glyphOf(record: Pick<RecordView, 'kind' | 'severity' | 'state' | 'active'>): Glyph {
  if (record.kind === 'operation' && record.severity === 'info') {
    if (record.active) {
      return { name: 'loader-circle', busy: record.state === 'running' ? 'spin' : 'idle' };
    }

    if (record.state === 'cancelled') {
      return { name: 'circle-minus', busy: 'idle' };
    }
  }

  return { name: STATUS_GLYPH[record.severity], busy: undefined };
}

/** What names a toast: its severity word, then its title ("Error: Timed out"), as the mock names it. */
export const toastLabel = (severity: Severity, title: string): string => `${SEVERITY_WORD[severity]}: ${title}`;

/** What the summary toast says: how many records wait behind the toasts that are drawn (S79). */
export const summaryTitle = (count: number): string => `${String(count)} more notification${count === 1 ? '' : 's'}`;

/** What names the control that dismisses a toast: the toast it dismisses. */
export const dismissLabel = (title: string): string => `Dismiss: ${title}`;

/**
 * How the second line joins the state's word to the sentence: a dot after a word ("Paused · Waiting for the queue"), a space after a word that already ends a sentence ("Outcome unknown. Check prod-db."),
 * nothing when either is empty.
 */
export function joinOf(word: string, text: string): 'dot' | 'space' | 'none' {
  if (word === '' || text === '') {
    return 'none';
  }

  return word.endsWith('.') ? 'space' : 'dot';
}

/** The commands a toast has room for (the mock's budget for a toast and an inline rendering): the centre shows all four. */
export const TOAST_ACTIONS = 2;

/**
 * The buttons of a toast: the record's actions in the order the model decided, the ones that can be used now, at most two. An action that cannot be used is no button (a button that does nothing is a stub): the
 * record's `reason` says why in words under the text, and the notification centre, which has room, lists them all.
 */
export const shownActions = (record: Pick<RecordView, 'actions'>): readonly ActionView[] => record.actions.filter((action) => action.disabled === '').slice(0, TOAST_ACTIONS);

/** The glyph before a button's label: the one the producer declared when the kit has it, else the verb's own (Retry turns, Cancel crosses); an Open or a custom action has none. */
export function actionIconOf(action: Pick<ActionView, 'kind' | 'icon'>): IconName | undefined {
  if (action.icon !== '' && isIconName(action.icon)) {
    return action.icon;
  }

  return action.kind === 'retry' ? 'refresh' : action.kind === 'cancel' ? 'close' : undefined;
}
