import { parseAppError } from '@omniviewdev/runtime/ui/v1';
import type { NoticesStore } from '../core/notices';
import type { ActionFailure } from './core/model';
import type { Operation } from './core/types';

// What the person is told when the host did not do what the page asked of a plugin (ch16 S75, S77, S135): a sticky error notice of the host with the cause in the user's terms and a Retry that runs the same call again.
//
// The host's calls on a plugin fail with its own error, which is NOT the gated envelope the resource calls fail with: its detail holds absolute paths, the process's own first line and whatever the plugin printed, and nothing
// cleans it (`backend/pkg/plugin`, `docs/ui-next/status/PL1.md` PLB-04, PLB-20), and a plain Go error carries no class at all. So the words here are chosen by the CLASS of the error, the one thing of it that is the host's
// (`parseAppError(error).type`, a closed set of constants), and nothing of its text is read.

const VERBS: Readonly<Record<Operation, string>> = { reload: 'reload', retry: 'restart', enable: 'enable', disable: 'disable', uninstall: 'uninstall' };

const GENERIC = 'The host couldn\'t finish it. Try again.';

/** The sentence for each class of error the host's plugin calls fail with. */
const SENTENCES: Readonly<Record<string, string>> = {
  'omniview:plugin/not-found': 'It is no longer installed.',
  'omniview:plugin/not-loaded': 'It isn\'t loaded right now.',
  'omniview:plugin/load-failed': 'The host couldn\'t stop it or start it.',
  'omniview:plugin/build-failed': 'Its development build failed.',
  'omniview:validation': 'The host won\'t do that to this plugin.',
};

/** What a failed uninstall leaves: the host keeps the plugin listed and finishes the uninstall when it is asked again (`backend/pkg/plugin/installer.go`). */
const UNINSTALL_LEFT = 'Some of its files may be left. It is still listed: uninstall it again to finish.';

const CANCELLED = 'omniview:cancelled';

/** The title and the one sentence of a failure, or `undefined` for a cancellation. Nothing of the error's own text is in it. */
export function describeFailure(operation: Operation, name: string, error: unknown): { readonly title: string; readonly detail: string } | undefined {
  const { type } = parseAppError(error);
  if (type === CANCELLED) {
    return undefined;
  }

  const known = SENTENCES[type];
  return { title: `Couldn't ${VERBS[operation]} ${name}`, detail: known ?? (operation === 'uninstall' ? UNINSTALL_LEFT : GENERIC) };
}

/** Tells the person: a sticky error toast of the host, whose Retry runs the call again. A second failure of the same words is a count on the one toast. */
export function reportFailure(store: NoticesStore, failure: ActionFailure): void {
  const said = describeFailure(failure.operation, failure.name, failure.error);
  if (said === undefined) {
    return;
  }

  console.error(`[plugins] ${failure.operation} of ${failure.id} failed`, failure.error);
  store.notify({
    severity: 'error',
    title: said.title,
    detail: said.detail,
    initiator: 'user',
    actions: [{ id: 'again', label: 'Retry', icon: 'rotate-cw', primary: true, run: failure.retry }],
  });
}
