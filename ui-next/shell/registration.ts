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
  /** The entry of the page on screen: selected, and where the tree's tab stop starts. Absent when the page on screen is not this sidebar's (the rail shows another plugin's sidebar): no entry is selected. */
  readonly current?: string | undefined;
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

/** One entry of the window's rail: a place whose sidebar the window can show. The shell knows it by its id, its name and its glyph, and nothing of what stands behind it. */
export type ShellRailEntry = {
  /** What the host is told when the entry is chosen. */
  readonly id: string;
  /** The entry's accessible name and its tooltip. */
  readonly label: string;
  readonly icon: IconName;
};

/**
 * The rail (ch16 R5, ch12 section 4): the 40 px column left of the sidebar, one entry for each place the window can show the sidebar of, in the order they are drawn. Choosing an entry
 * tells the host (`ShellProps.onSelectRail`); the host registers that entry as `current` and the sidebar it hands over with it, and only then is it selected. The rail is one tab stop: the
 * arrows move the focus and select nothing.
 */
export type ShellRail = {
  /** Names the group of entries. */
  readonly label: string;
  readonly entries: readonly ShellRailEntry[];
  /** The entry whose sidebar is shown, an `id` of `entries`: selected (`aria-current`), and where the tab stop starts. Absent: none is, and the first holds the tab stop. */
  readonly current?: string | undefined;
};

export type ShellRegistration = {
  /** The plugin the screen belongs to: its name names the frame's landmarks ("<name> workspace", "<name> scope"). */
  readonly plugin: { readonly name: string };
  /** The rail: the 40 px column of entries left of the sidebar. Absent, or with no entries: no rail, no track. */
  readonly rail?: ShellRail;
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
