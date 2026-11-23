// Which window a page is in, as the host's window service knows it (`backend/window`: a window has a name and a kind, `workspace`, `panel` or `settings`; `Window.Name()` of the runtime gives the name and `List()` the kinds). The app's own
// Settings window is a window of its own, and the new UI draws its content there and no shell. Plain TypeScript over the two calls, so a test hands it answers. Anything that goes wrong is `other`: a window that cannot be told what it is draws
// the shell, which is a window a person can always leave; a Settings window that drew the shell would be a second main window, and one that drew nothing would be a trap.

export type WindowKind = 'settings' | 'other';

export type WindowKindOptions = {
  /** The name the runtime gives the window this page is in. */
  readonly name: () => Promise<string>;
  /** The windows the host's service knows, with their kinds (`List`). */
  readonly list: () => Promise<ReadonlyArray<{ readonly name: string; readonly kind: string }>>;
};

export async function resolveWindowKind({ name, list }: WindowKindOptions): Promise<WindowKind> {
  try {
    const own = await name();
    const known = await list();
    return known.find((window) => window.name === own)?.kind === 'settings' ? 'settings' : 'other';
  } catch {
    return 'other';
  }
}
