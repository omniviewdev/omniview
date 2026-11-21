import { Button, compactAge, Icon, IconButton, tip, useAge } from '@omniviewdev/kit';
import { useId, type MouseEvent } from 'react';
import type { RecordView } from '../core/notices';
import { timeOf } from './centreList';
import { tipAge } from './centreWords';
import styles from './Centre.module.css';
import { actionIconOf, dismissLabel, glyphOf, joinOf, SEVERITY_WORD } from './words';

// One row of the notification centre (ch16 S80, S81, S83; the mock's `H.notification` of the centre surface, shell-notify.js `view`): the title is a button that opens and closes the row, 40 px collapsed, with the glyph, the
// title and one line, the time and the mark of an unread row; the buttons stay out of sight until the row is hovered or has the focus, and open with it. The words are the model's, made once for every surface
// (`RecordView`): the severity as a word before the title (S83: never colour alone), the count of a repeat in the title or the second line, and, for an action that cannot be used, the reason in a sentence and no button
// (the lead's rule for every surface: never a dead button).

export type RowProps = {
  readonly record: RecordView;
  readonly expanded: boolean;
  /** The row was opened or closed by its title. */
  readonly onToggle: (id: string) => void;
  /** The row's Dismiss: it leaves the history (it can be brought back for ten seconds). */
  readonly onRemove: (id: string) => void;
  /** One of the row's actions was pressed. */
  readonly onRun: (id: string, action: string, event: MouseEvent<HTMLButtonElement>) => void;
};

/** The colour of the dot of an unread row: the worst of its severities, as the bell's (S81). */
const toneOf = (record: RecordView): 'error' | 'warning' | 'info' => (record.severity === 'error' ? 'error' : record.severity === 'warning' ? 'warning' : 'info');

export function CentreRow({ record, expanded, onToggle, onRemove, onRun }: RowProps) {
  const detail = useId();
  const at = timeOf(record);
  const label = useAge(at, compactAge);
  const stamp = useAge(at, tipAge);
  const glyph = glyphOf(record);
  const join = joinOf(record.word, record.text);
  const actions = record.actions.filter((action) => action.disabled === '');
  return (
    <article
      className={styles.row}
      data-notices-part="row"
      data-notices-id={record.id}
      data-severity={record.severity}
      data-kind={record.kind}
      data-unread={record.unread ? '' : undefined}
      data-expanded={expanded ? '' : undefined}
    >
      <button
        type="button"
        className={styles.toggle}
        data-notices-part="rowToggle"
        aria-expanded={expanded}
        aria-controls={detail}
        onClick={() => {
          onToggle(record.id);
        }}
      >
        <span className={styles.glyph} data-notices-part="rowGlyph" data-busy={glyph.busy} aria-hidden="true">
          <Icon name={glyph.name} />
        </span>
        <span className={styles.column}>
          <span className={styles.title} data-notices-part="rowTitle" dir="auto">
            <span className={styles.hidden}>{`${SEVERITY_WORD[record.severity]}: `}</span>
            {record.title}
          </span>
          {record.word === '' && record.text === '' ? null : (
            <span className={styles.message} data-notices-part="rowText" dir="auto">
              {record.word === '' ? null : <span className={styles.state}>{record.word}</span>}
              {join === 'dot' ? <span aria-hidden="true"> · </span> : join === 'space' ? ' ' : null}
              {record.text === '' ? null : <span>{record.text}</span>}
            </span>
          )}
        </span>
        <span className={styles.meta}>
          <time className={styles.time} data-notices-part="rowTime" dateTime={new Date(at).toISOString()} {...tip(stamp)}>
            {label}
          </time>
          <span className={styles.unread} data-notices-part="rowDot" data-tone={toneOf(record)}>
            {record.unread ? <span className={styles.hidden}>Unread</span> : null}
          </span>
        </span>
      </button>
      <div id={detail} className={styles.detail} data-notices-part="rowDetail" hidden={!expanded}>
        {expanded && record.reason !== '' ? (
          <p className={styles.reason} data-notices-part="rowReason" dir="auto">
            {record.reason}
          </p>
        ) : null}
      </div>
      <div className={styles.actions} role="group" aria-label={`Actions: ${record.title}`} data-notices-part="rowActions">
        {expanded
          ? actions.map((action) => (
            <Button
              key={action.id}
              tone={action.danger ? 'danger' : 'neutral'}
              icon={actionIconOf(action)}
              onClick={(event) => {
                onRun(record.id, action.id, event);
              }}
            >
              {action.label}
            </Button>
          ))
          : null}
        <IconButton
          data-notices-part="rowDismiss"
          icon="close"
          variant="ghost"
          size="row"
          label={dismissLabel(record.title)}
          {...tip('Dismiss')}
          onClick={() => {
            onRemove(record.id);
          }}
        />
      </div>
    </article>
  );
}
