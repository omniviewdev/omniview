import type { IconName } from '@omniviewdev/kit';

// What the tab on screen tells the shell about its plugin's frame: the seed of the contribution contract (decision R11, plan 2.4). Plain data. The shell
// reads it and knows nothing of the plugin behind it; a plugin never reaches into the shell's DOM (ch16 S1). Every field is one line
// of the contribution table of ch16 S10; ui-next/shell/README.md lists the limits S10 sets, which review holds until a contribution
// API checks them at registration. What a tab is called and where it sits (the tab's title and glyph, the status bar's path) is not here: it is the tab model's (core/tabs), which
// asks the plugin through `Contributions.describe`.

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

/** One face of the scope lane: the scope the page is read in. Text for now; the menus that change a scope arrive with their slice. */
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
  /**
   * The plugin's frame has a rail of tools (R5): a 40 px track left of the sidebar. The tools are not part of the contract yet, so a
   * declared rail keeps its track empty and the page lands where the mock puts it (README, "Decisions"). Absent: no rail, no track.
   */
  readonly rail?: true;
  /** Absent: no sidebar, no track. */
  readonly sidebar?: ShellSidebar;
  /** The scope lane above the page, at most 2 faces (ch16 S10). Absent or empty: no lane, no 40 px. */
  readonly scope?: readonly ShellScopeFace[];
  /**
   * Who scrolls the page (ch12 section 5; the mock's `AWS.page(id, render, { layout })`). `document` (the default): the shell's page scrolls, the
   * content flows at its natural height. `pane`: the page owns its scrolling (a collection view), so the shell scrolls nothing: the content fills
   * the island under the scope lane, its bottom inset is the page's own (a collection's footer is the last lane of the pane), and the page has no
   * tab stop of its own. The page declares it; a page whose layout depends on its state re-registers.
   */
  readonly layout?: 'document' | 'pane';
  /**
   * The plugin's frame is on its way: its interface is loading and the window does not wait for it. The shell draws the regions a plugin's frame has, empty, at the rectangles the
   * frame will have (the rail's track, the sidebar with no tree, the scope lane), so nothing moves when the frame registers. Whatever else the registration declares is drawn as
   * declared. A frame that turns out to have fewer regions than that moves the page once, when it registers: the shape of a plugin's frame is not known before it loads.
   */
  readonly pending?: true;
};
