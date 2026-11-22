// What the host's request to show Settings asks for (`backend/window/settings.go`: `OpenSettings(target)`, `SettingsState.Target`): a local route such as `/settings?category=terminal` or `/settings?category=terminal&setting=terminal.fontSize`. The
// Settings window reads the category (the page); a setting to focus is a later slice. Plain TypeScript. A target that names nothing Settings knows says nothing: the page the window was on stays.

/** The page a target names, or `undefined` when it names none. */
export function pageOfTarget(target: string): string | undefined {
  const query = target.split('#', 1)[0]?.split('?', 2)[1];
  if (query === undefined) {
    return undefined;
  }

  const category = new URLSearchParams(query).get('category');
  return category === null || category === '' || category.length > 256 ? undefined : category;
}
