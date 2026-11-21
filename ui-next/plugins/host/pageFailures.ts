import type { PageHeaderCommands } from '@omniviewdev/kit';
import { useCallback, useMemo } from 'react';
import type { DetailSource, ListPageDefinition } from '../contract/v1';
import { useNotices } from '../../shell';
import { failureNotice } from './notices';

// A failed action of a PAGE is the one real source of the toast layer (O1b-1; ch16 S75, S77, S85): the commands of a page's header are the plugin's callbacks (`onSelect`, typed as returning nothing, and a plugin's
// handler is `async`), and what happens when one fails is the host's to say, because the plugin's own handler has no place to say it: a throw in an event handler ends at the window's error report, and a rejected
// promise at an unhandled rejection. So the host wraps each command where it draws the header. A throw, or a rejection, is the plugin's failure notice (`notices.ts`: the host's `apperror` as a toast), with a way to ask
// again that runs the same command by the same path, so a second failure is a count on the one toast. A command that works is called through untouched. The Refresh of the header is the page's own and fails into the
// page's own words (a stale view with a Retry): it is not wrapped, and a passive refresh failure is never a toast (S85).

/** What the host is told when a command failed: the error, a way to run the same command again, and what the command is called. */
export type CommandFailure = (error: unknown, retry: () => void, command: { readonly id: string; readonly label: string }) => void;

// The contract types `onSelect` as returning nothing, and a plugin's handler may return a promise anyway: what it answers is read as unknown.
type Guardable = { readonly id: string; readonly label: string; readonly onSelect: () => unknown };

const isThenable = (value: unknown): value is PromiseLike<unknown> => typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';

function guard<TCommand extends Guardable>(command: TCommand, failed: CommandFailure): TCommand {
  const run = (): void => {
    const fail = (error: unknown): void => {
      try {
        failed(error, run, { id: command.id, label: command.label });
      } catch (problem) {
        // The report of a failure is not worth the page: a window that cannot tell the person still has its page.
        console.error('[page] the report of a failed command failed', problem);
      }
    };

    try {
      const answer: unknown = command.onSelect();
      if (isThenable(answer)) {
        answer.then(undefined, fail);
      }
    } catch (error) {
      fail(error);
    }
  };

  return { ...command, onSelect: run };
}

/** The commands of a header with every `onSelect` guarded: the primary, the secondary ones, the danger one and the overflow menu. Nothing in, nothing out. */
export function guardCommands(commands: Omit<PageHeaderCommands, 'utility'> | undefined, failed: CommandFailure): Omit<PageHeaderCommands, 'utility'> | undefined {
  if (commands === undefined) {
    return undefined;
  }

  return {
    ...commands,
    ...(commands.primary === undefined ? {} : { primary: guard(commands.primary, failed) }),
    ...(commands.secondary === undefined ? {} : { secondary: commands.secondary.map((command) => guard(command, failed)) }),
    ...(commands.danger === undefined ? {} : { danger: guard(commands.danger, failed) }),
    ...(commands.menu === undefined ? {} : { menu: commands.menu.map((entry) => guard(entry, failed)) }),
  };
}

/** What a plugin's failed command becomes in this window: its failure notice, with the way to ask again. */
function usePageFailures(plugin: string): CommandFailure {
  const { store } = useNotices();
  return useCallback<CommandFailure>(
    (error, retry) => {
      failureNotice(store, plugin, error, retry);
    },
    [store, plugin],
  );
}

/** A list page's definition with its header commands guarded. The same object while there is nothing to guard. */
export function useGuardedDefinition<TRow>(definition: ListPageDefinition<TRow>, plugin: string): ListPageDefinition<TRow> {
  const failed = usePageFailures(plugin);
  return useMemo(() => (definition.commands === undefined ? definition : { ...definition, commands: guardCommands(definition.commands, failed) }), [definition, failed]);
}

/** A detail page's source with the commands of its view guarded. The same object while there is nothing to guard. */
export function useGuardedSource(source: DetailSource, plugin: string): DetailSource {
  const failed = usePageFailures(plugin);
  return useMemo(() => {
    const { view } = source;
    return view?.commands === undefined ? source : { ...source, view: { ...view, commands: guardCommands(view.commands, failed) } };
  }, [source, failed]);
}
