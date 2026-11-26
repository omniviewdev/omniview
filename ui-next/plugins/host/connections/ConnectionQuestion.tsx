import { ConfirmDialog } from '@omniviewdev/kit';
import { useSyncExternalStore } from 'react';
import type { Questions } from './questions';

// The dialog of the question a verb on a connection asks (KL4; `questions.ts`): the kit's `ConfirmDialog`, drawn by the host over the window, nothing while no question is open. Mounting is opening: the question is the
// store's, so a dialog that is shown for another question starts clean (`key`), and the person's answer goes back to the store, which settles the verb the plugin called.

export function ConnectionQuestion({ questions }: { readonly questions: Questions }) {
  const open = useSyncExternalStore(questions.subscribe, questions.getSnapshot);
  return open === null ? null : (
    <ConfirmDialog
      key={open.id}
      title={open.title}
      icon={open.icon}
      tone={open.tone}
      subject={open.subject}
      message={open.message}
      confirmLabel={open.confirmLabel}
      busy={open.busy}
      error={open.error}
      onConfirm={questions.confirm}
      onCancel={questions.cancel}
    />
  );
}
