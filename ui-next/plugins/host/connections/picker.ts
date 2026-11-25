import type { IconName } from '@omniviewdev/kit';
import type { ShellPickerOption, ShellScopePicker } from '../../../shell';
import type { HostConnection } from './types';
import { faceOf } from './words';

// The picker the scope lane's connection face opens (HM1), made from what the window knows: the connections of the plugin whose page is on screen, each by its NAME with the state it is in (`words.ts`), and the one the face says
// now. The shell draws it and tells the host what was chosen; nothing here draws.

/** What the picker needs from the window. */
export type PickerInput = {
  /** The plugin whose page is on screen: only its connections are offered. */
  readonly plugin: string;
  /** Every connection the window knows, of every plugin. */
  readonly connections: readonly HostConnection[];
  /** The key the page's route names. Absent: the plugin chose one itself, and the face's own text is all there is to know it by. */
  readonly named: string | undefined;
  /** What the connection face says (the connection's name, as the page's lane published it). */
  readonly text: string | undefined;
  /** The face's own glyph: every option wears it. */
  readonly icon: IconName;
  /** The picker opened: read the states again. */
  readonly onOpen: () => void;
  /** An option was chosen: its key. */
  readonly onChoose: (key: string) => void;
};

const TITLE = 'Connections';

/**
 * The picker of the connection face, or `undefined` when the plugin has no connection the window knows (the face is then text, as it always was). The CURRENT option is the one the route names; when the route names none (the
 * plugin chose its first itself) it is the one connection whose name is the face's text, and when two share it, none is: nothing is marked rather than the wrong one.
 */
export function pickerOf({ plugin, connections, named, text, icon, onOpen, onChoose }: PickerInput): ShellScopePicker | undefined {
  const mine = connections.filter((connection) => connection.plugin === plugin);
  if (mine.length === 0) {
    return undefined;
  }

  const options = mine.map((connection): ShellPickerOption => ({
    id: connection.key,
    label: connection.name,
    detail: connection.detail,
    state: faceOf(connection.state),
    reason: connection.reason,
    busy: connection.state === 'connecting',
  }));
  const byName = text === undefined ? [] : mine.filter((connection) => connection.name === text);
  // The route's own key when it names one; only a route that names none is read by the name its face says (and only when one connection has it).
  const current = named !== undefined ? (mine.some((connection) => connection.key === named) ? named : undefined) : byName.length === 1 ? byName[0]?.key : undefined;
  return { title: TITLE, placeholder: 'Search connections', empty: 'None to choose from', icon, options, current, onOpen, onChoose };
}
