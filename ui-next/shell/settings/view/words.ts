import type { FieldMessage as LaneMessage } from '@omniviewdev/kit';
import type { FieldMessage, Json } from '../../core/fields';

// The words the sheet says on a row, as plain functions: the model's message in the kit lane's vocabulary, the note that a setting was changed elsewhere under a draft, and the name of the reset control.

/** The lane's messages are at most 80 characters (S127). */
const LIMIT = 80;

const WORD = { restart: 'info' } as const;

/**
 * What the lane of a row says: the model's message, and nothing it does not have a word for. The model's `restart` is the lane's standing info. The note that the setting was changed elsewhere (`elsewhereNote`) is an
 * info of the same rank as a restart: it shows when the model has nothing that outranks it, which is a hint, a restart or nothing; a failure, a check that is running, a check that could not be made and a saved value come first.
 */
export function laneOf(message: FieldMessage | undefined, note: string | undefined): LaneMessage | undefined {
  const outranked = message !== undefined && message.kind !== 'hint' && message.kind !== 'restart' && message.kind !== 'info';
  if (note !== undefined && !outranked) {
    return { kind: 'info', text: note };
  }

  if (message === undefined) {
    return undefined;
  }

  const kind = message.kind === 'restart' ? WORD.restart : message.kind;
  return { kind, text: message.text, ...(message.detail === undefined ? {} : { detail: message.detail }), ...(message.retry === true ? { retry: true } : {}) };
}

/** A value as a sentence says it: a switch is on or off, an empty value is nothing, and a long text is cut with its ellipsis. */
function said(value: Json | undefined, room: number): string {
  if (value === undefined || value === null || value === '') {
    return 'nothing';
  }

  if (typeof value === 'boolean') {
    return `“${value ? 'on' : 'off'}”`;
  }

  const text = String(value);
  return `“${text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text}”`;
}

/** What a field says while the person has a draft of it and the host changed it: the new value, and the way to take it. */
export function elsewhereNote(value: Json | undefined): string {
  const tail = '. Escape takes it.';
  const head = 'Changed elsewhere to ';
  // Two quotation marks come with a text; the room is what is left of the lane.
  return `${head}${said(value, LIMIT - head.length - tail.length - 2)}${tail}`;
}

/** The name of the control that puts a setting back to its default (S126). */
export const resetLabel = (label: string): string => `Reset ${label} to default`;
