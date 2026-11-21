import { Button, Icon, IconButton, tip } from '@omniviewdev/kit';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type { RecordView, Severity, ToastItem } from '../core/notices';
import { useNotices } from './context';
import styles from './Toasts.module.css';
import { SEVERITY_WORD, actionIconOf, dismissLabel, glyphOf, joinOf, shownActions, summaryTitle, toastLabel, type Glyph } from './words';

// One toast (ch16 S79, S83, S86; the mock's `view` for the toast surface, shell-notify.js): a glyph, a title and one sentence, the buttons its record's actions made, and a control to dismiss it. The words are the
// model's, made once for every surface (`RecordView`); this draws them. A toast is a `status`, or an `alert` for an error of work the user started (O6, S86), and is announced by being inserted: the words of one that
// changed afterwards are drawn from an attribute, so nothing is written into the live region and nothing is told twice.

/** Whether `value` is not what it was when this component first drew it: once it changed it stays changed, so a number that comes back to where it started is not told again. */
function useChanged(value: number): boolean {
  const [first] = useState(value);
  const [changed, setChanged] = useState(false);
  if (!changed && value !== first) {
    setChanged(true);
  }

  return changed;
}

/** Escape closes the toast the focus is in (the mock's §J keys; S12: acts on one layer at a time). An Escape that composes an input method's text, or that carries a modifier, is not ours. */
function closesOn(event: KeyboardEvent): boolean {
  return event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.altKey && !event.ctrlKey && !event.metaKey;
}

type FrameProps = {
  readonly item: ToastItem;
  readonly severity: Severity;
  readonly glyph: Glyph;
  /** The title as a person reads it: it names the toast and its dismiss control. */
  readonly title: string;
  /** The first toast of the stack is its one stop for F6 (S12, S13). */
  readonly first: boolean;
  readonly summary: boolean;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
};

/** The toast's box, its glyph and its dismiss control. A `div`, not an `article`: ARIA in HTML does not allow the `alert` or `status` role on an `article` (axe: `aria-allowed-role`), and the role is what announces the toast. */
function Frame({ item, severity, glyph, title, first, summary, onDismiss, children }: FrameProps) {
  return (
    <div
      className={styles.toast}
      role={item.urgent ? 'alert' : 'status'}
      tabIndex={-1}
      aria-label={toastLabel(severity, title)}
      data-notices-part="toast"
      data-notices-key={item.key}
      data-notices-summary={summary ? '' : undefined}
      data-severity={severity}
      data-sticky={item.sticky ? '' : undefined}
      data-shell-focus={first ? '' : undefined}
      onKeyDown={(event) => {
        if (closesOn(event)) {
          // Handled here, so the shell's own Escape (back to the page) leaves it alone: the focus goes back to where it was, never to the page by default.
          event.preventDefault();
          onDismiss();
        }
      }}
    >
      <span className={styles.glyph} data-notices-part="glyph" data-busy={glyph.busy}>
        <Icon name={glyph.name} />
      </span>
      <div className={styles.main} data-notices-part="main">
        {children}
      </div>
      <span className={styles.dismiss}>
        <IconButton data-notices-part="dismiss" icon="close" variant="ghost" size="row" label={dismissLabel(title)} {...tip('Dismiss')} onClick={onDismiss} />
      </span>
    </div>
  );
}

/** The severity's word, which leads the text a live region reads (S83: never colour alone), and the title. */
function Head({ severity, title, quiet }: { readonly severity: Severity; readonly title: string; readonly quiet: boolean }) {
  return (
    <div className={styles.head}>
      <span className={styles.hidden} data-notices-part="severity">
        {`${SEVERITY_WORD[severity]}: `}
      </span>
      <span className={styles.title} data-notices-part="title" dir="auto" data-text={quiet ? title : undefined}>
        {quiet ? null : title}
      </span>
    </div>
  );
}

/** The buttons of a record's actions the toast has room for. A refusal of the host (the action stopped being available since it was drawn) is told, never silent. */
function Actions({ record }: { readonly record: RecordView }) {
  const { store, announcer } = useNotices();
  const shown = shownActions(record);
  if (shown.length === 0) {
    return null;
  }

  return (
    <div className={styles.actions} data-notices-part="actions">
      {shown.map((action) => (
        <Button
          key={action.id}
          variant={action.variant === 'primary' ? 'primary' : 'secondary'}
          tone={action.danger ? 'danger' : 'neutral'}
          icon={actionIconOf(action)}
          onClick={(event) => {
            const result = store.run(record.id, action.id, event);
            if (result.status === 'refused') {
              announcer.announce(result.message, { urgent: false });
            }
          }}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

function RecordToast({ item, record, first }: { readonly item: ToastItem; readonly record: RecordView; readonly first: boolean }) {
  const { store } = useNotices();
  const quiet = useChanged(record.rev);
  const join = joinOf(record.word, record.text);
  return (
    <Frame
      item={item}
      severity={record.severity}
      glyph={glyphOf(record)}
      title={record.title}
      first={first}
      summary={false}
      onDismiss={() => {
        store.dismiss(record.id);
      }}
    >
      <Head severity={record.severity} title={record.title} quiet={quiet} />
      {record.word === '' && record.text === '' ? null : (
        <div className={styles.message} data-notices-part="message">
          {record.word === '' ? null : <span className={styles.state}>{record.word}</span>}
          {join === 'dot' ? <span aria-hidden="true"> · </span> : join === 'space' ? ' ' : null}
          {record.text === '' ? null : (
            <span className={styles.text} dir="auto" data-text={quiet ? record.text : undefined}>
              {quiet ? null : record.text}
            </span>
          )}
        </div>
      )}
      {record.reason === '' ? null : (
        <div className={styles.message} data-notices-part="reason" dir="auto">
          {record.reason}
        </div>
      )}
      <Actions record={record} />
    </Frame>
  );
}

/** The toast that stands for the records that do not fit (S79): how many, the worst severity of them, and a Show where there is a centre to show them in. */
function SummaryToast({ item, first }: { readonly item: ToastItem; readonly first: boolean }) {
  const { store, centre } = useNotices();
  const summary = item.summary;
  const count = summary?.count ?? 0;
  const quiet = useChanged(count);
  if (summary === undefined) {
    return null;
  }

  const title = summaryTitle(count);
  return (
    <Frame
      item={item}
      severity={summary.severity}
      glyph={glyphOf({ kind: 'message', severity: summary.severity, state: 'succeeded', active: false })}
      title={title}
      first={first}
      summary
      onDismiss={() => {
        store.dismissSummary();
      }}
    >
      <Head severity={summary.severity} title={title} quiet={quiet} />
      {centre === true ? (
        <div className={styles.actions} data-notices-part="actions">
          <Button
            onClick={() => {
              store.showSummary();
            }}
          >
            Show
          </Button>
        </div>
      ) : null}
    </Frame>
  );
}

export function Toast({ item, first }: { readonly item: ToastItem; readonly first: boolean }) {
  return item.record === undefined ? <SummaryToast item={item} first={first} /> : <RecordToast item={item} record={item.record} first={first} />;
}
