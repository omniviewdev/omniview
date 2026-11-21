import { dataAttributes } from '../../shared/dataAttributes';
import { Icon, type IconName } from '../Icon';
import { tip } from '../TooltipHost';
import { KIND_WORD, wordsOf, type FieldMessage, type FieldMessageKind } from './message';
import styles from './Field.module.css';

const GLYPH: Readonly<Partial<Record<FieldMessageKind, IconName>>> = {
  error: 'status-error',
  warning: 'status-warning',
  retry: 'status-warning',
  saved: 'check',
  info: 'status-info',
};

type FieldLaneProps = {
  readonly id: string;
  readonly message: FieldMessage | undefined;
  readonly onRetry: (() => void) | undefined;
};

/**
 * The one line under a field where its message appears (design 16 S126, S127, A4): 16 px high whether it has a message or not, so a message
 * that comes, changes or goes moves nothing. It is a description of the control and never a live region: the model tells the shell's polite
 * region once, when an error or a warning is raised, and the lane is `aria-live="off"`. A check that is running has its loader in the lane from
 * the start and the stylesheet reveals it after a second (the mock's `field-message-reveal`; a quick check does not flash a loader, design 13 M2,
 * 05 local loading): there is no timer, and nothing is added to the page when the second is up.
 */
export function FieldLane({ id, message, onRetry }: FieldLaneProps) {
  const checking = message?.kind === 'checking';
  const glyph = message === undefined ? undefined : GLYPH[message.kind];
  const text = message === undefined ? '' : wordsOf(message);
  const word = message === undefined ? undefined : KIND_WORD[message.kind];
  const detail = message?.detail?.trim() ?? '';
  const retry = message?.retry === true && onRetry !== undefined;

  return (
    <div id={id} className={styles.lane} data-ov-part="lane" data-ov-kind={message?.kind} aria-live="off">
      {glyph === undefined ? null : <Icon name={glyph} />}
      {checking ? <Icon name="loader" data-ov-busy="true" /> : null}
      {word === undefined ? null : (
        <span className={styles.word} data-ov-part="word">
          {word}
        </span>
      )}
      {message === undefined ? null : (
        <span
          className={styles.message}
          data-ov-part="message"
          {...dataAttributes(detail === '' ? { 'data-ov-clip': '' } : tip(`${text}\n${detail}`))}
        >
          {text}
        </span>
      )}
      {detail === '' ? null : (
        // What did not fit in the line is part of the description, which reads the lane (a tooltip's text is not read through `aria-describedby`).
        <span className={styles.word} data-ov-part="detail">
          {` ${detail}`}
        </span>
      )}
      {retry ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
