import type { ShellScopeFace } from '../../contract/v1';

/**
 * The scope lane of the fixture's pages: the connection the page is read in, said by its NAME. A route carries a connection by its KEY, and the fixture's keys are made the way the host's own are (`<name>-<10 hex>`), so the name is
 * the key without its suffix: `north-57a082bd74` is `north` (a key of another shape is its own name). A page that has no connection says so under a label that is not Connection, because the palette says the text of the face
 * labelled Connection as the connection (C1f), and a placeholder would be said as one.
 */
export function laneOf(connection: string | undefined): readonly ShellScopeFace[] {
  return connection === undefined ? [{ label: 'Scope', icon: 'server', text: 'none' }] : [{ label: 'Connection', icon: 'server', text: connection.replace(/-[0-9a-f]{10}$/, '') }];
}
