import type { IconName } from '@omniviewdev/kit';

// What a screen tells the shell about itself: the seed of the contribution contract (decision R11, plan 2.4). Plain data. The shell
// reads it and knows nothing of the plugin behind it; a plugin never reaches into the shell's DOM (ch16 S1). Every field is one line
// of the contribution table of ch16 S10; ui-next/shell/README.md lists the limits S10 sets, which review holds until a contribution
// API checks them at registration.

/** A node of the sidebar's tree: an entry, or a group when it has children. */
export type ShellTreeNode = {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** The 12 px count slot at the end of an entry's row (ch12 SB1). Absent: the row has no count. */
  readonly count?: number | undefined;
  readonly children?: readonly ShellTreeNode[];
};

/** The colours the design gives a plugin's glyphs: the brand roles of the token manifest (ch01 palette policy). */
export type ShellAccent = 'orange' | 'green' | 'blue' | 'purple' | 'pink' | 'red' | 'teal';

export type ShellSidebar = {
  /** Names the navigation landmark and its tree. */
  readonly label: string;
  /** The title of the sidebar's header. */
  readonly title: string;
  readonly nodes: readonly ShellTreeNode[];
  /** The groups open at first. Every ancestor of `current` is open as well. */
  readonly open?: readonly string[];
  /** The entry of the page on screen: selected, and where the tree's tab stop starts. */
  readonly current?: string;
  /** The colour of the tree's glyphs (the mock's tile colour, one per plugin). Absent: the icon colour of the theme. */
  readonly accent?: ShellAccent | undefined;
};

/** One face of the scope lane: the scope the page is read in. Text for now; the menus that change it arrive with their slice. */
export type ShellScopeFace = {
  /** What the value is, for assistive technology: read before the value. */
  readonly label: string;
  readonly icon: IconName;
  /** The value, at most 24 characters (ch16 S10). */
  readonly text: string;
};

export type ShellRegistration = {
  /** The plugin the screen belongs to: its name names the frame's landmarks ("<name> workspace", "<name> scope"). */
  readonly plugin: { readonly name: string };
  /** The page as a tab shows it. A title of at most 3 words (ch16 S10). */
  readonly tab: { readonly title: string; readonly icon: IconName };
  /** The status bar's path, root first; the last crumb is the page. Text: a crumb that navigates arrives with navigation. */
  readonly path: readonly string[];
  /**
   * The plugin's frame has a rail of tools (R5): a 40 px track left of the sidebar. The tools are not part of the contract yet, so a
   * declared rail keeps its track empty and the page lands where the mock puts it (README, "Decisions"). Absent: no rail, no track.
   */
  readonly rail?: true;
  /** Absent: no sidebar, no track. */
  readonly sidebar?: ShellSidebar;
  /** The scope lane above the page, at most 2 faces (ch16 S10). Absent or empty: no lane, no 40 px. */
  readonly scope?: readonly ShellScopeFace[];
};
