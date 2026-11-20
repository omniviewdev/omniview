import type { PageOperationView, RecordView } from './types';

// The page header's operation slot (ch05 OF2, ch12 PH2; the kit's `PageOperation`): the inline rendering of ONE record, drawn where the work began. The record is the model's; the slot is fed the
// words, how far it is and its commands, with nothing wired behind it but the three callbacks. While the work is active the slot shows its Cancel; once it ended, its first command.

/** What the slot takes for a record: its name, its state, the one sentence, the fraction (or `indeterminate`), the commands in priority order, and how to let an outcome go. */
export function pageOperationOf(record: RecordView, select: (action: string) => () => void, dismiss: () => void): PageOperationView {
  const progress = record.active && record.progress !== undefined ? (record.progress.fraction ?? 'indeterminate') : undefined;
  return Object.freeze({
    title: record.title,
    state: record.state,
    text: record.phase,
    progress,
    actions: Object.freeze(record.actions.map((action) => Object.freeze({
      id: action.id,
      label: action.label,
      kind: action.kind === 'open' ? 'custom' as const : action.kind,
      onSelect: select(action.id),
      disabledReason: action.disabled === '' ? undefined : action.disabled,
    }))),
    onDismiss: dismiss,
  });
}
