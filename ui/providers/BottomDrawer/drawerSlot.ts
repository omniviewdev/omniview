import type { BottomDrawerTab } from '@omniviewdev/runtime';

/**
 * The bottom drawer's per-window state slot (`drawer`), and the serialized tab
 * form that moves between windows (drag payload, menu delivery, tear-off).
 *
 * Icons are not serialized: they may be React nodes. The receiving window
 * derives them from the tab variant.
 */

export type DrawerTabVariant = BottomDrawerTab['variant'];

export type DrawerMode = 'minimized' | 'expanded';

export type SerializedDrawerTab = {
  id: string;
  title: string;
  variant: DrawerTabVariant;
  properties?: Record<string, unknown>;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
};

export type DrawerSlot = {
  version: 1;
  tabs: SerializedDrawerTab[];
  focusedId: string | null;
  mode?: DrawerMode;
  /** Last expanded (non-minimized, non-fullscreen) drawer height in px. */
  height?: number;
};

const drawerTabVariants: Readonly<Record<DrawerTabVariant, true>> = {
  'terminal': true,
  'logs': true,
  'editor': true,
  'browser': true,
  'file': true,
  'devbuild': true,
  'plugin-logs': true,
  'editor-debug': true,
  'other': true,
};

function isDrawerTabVariant(value: unknown): value is DrawerTabVariant {
  return typeof value === 'string' && Object.hasOwn(drawerTabVariants, value);
}

const drawerTabIconByVariant: Readonly<Partial<Record<DrawerTabVariant, string>>> = {
  'terminal': 'LuSquareTerminal',
  'logs': 'LuLogs',
  'devbuild': 'LuHammer',
  'plugin-logs': 'LuScroll',
  'editor-debug': 'LuFileCode',
};

/** Terminal tabs carry a `pending-` id until their backend session exists. */
export function isPendingDrawerTab(tab: { id: string }): boolean {
  return tab.id.startsWith('pending-');
}

/** A terminal tab backed by a real exec session (not a `pending-` placeholder). */
export function isTerminalSessionTab(tab: { id: string; variant: DrawerTabVariant }): boolean {
  return tab.variant === 'terminal' && !isPendingDrawerTab(tab);
}

export function serializeDrawerTab(tab: BottomDrawerTab): SerializedDrawerTab {
  return {
    id: tab.id,
    title: tab.title,
    variant: tab.variant,
    ...(tab.properties !== undefined && { properties: tab.properties }),
    createdAt: tab.createdAt.toISOString(),
    updatedAt: tab.updatedAt.toISOString(),
  };
}

export function hydrateDrawerTab(tab: SerializedDrawerTab): BottomDrawerTab {
  return {
    id: tab.id,
    title: tab.title,
    variant: tab.variant,
    icon: drawerTabIconByVariant[tab.variant],
    properties: tab.properties,
    createdAt: new Date(tab.createdAt),
    updatedAt: new Date(tab.updatedAt),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`drawer tab ${field} must be an ISO timestamp`);
  }

  return value;
}

/** Validates one serialized drawer tab. Throws on anything malformed. */
export function parseSerializedDrawerTab(value: unknown): SerializedDrawerTab {
  if (!isRecord(value)) {
    throw new Error('drawer tab must be an object');
  }

  const { id, title, variant, properties, createdAt, updatedAt } = value;
  if (typeof id !== 'string' || id === '') {
    throw new Error('drawer tab id must be a non-empty string');
  }

  if (typeof title !== 'string') {
    throw new Error(`drawer tab ${id} title must be a string`);
  }

  if (!isDrawerTabVariant(variant)) {
    throw new Error(`drawer tab ${id} has unknown variant ${String(variant)}`);
  }

  if (properties !== undefined && !isRecord(properties)) {
    throw new Error(`drawer tab ${id} properties must be an object`);
  }

  return {
    id,
    title,
    variant,
    ...(properties !== undefined && { properties }),
    createdAt: parseTimestamp(createdAt, 'createdAt'),
    updatedAt: parseTimestamp(updatedAt, 'updatedAt'),
  };
}

/** Validates a saved `drawer` slot. Throws on anything malformed. */
export function parseDrawerSlot(value: unknown): DrawerSlot {
  if (!isRecord(value)) {
    throw new Error('drawer slot must be an object');
  }

  const { version, tabs, focusedId, mode, height } = value;
  if (version !== 1) {
    throw new Error(`unsupported drawer slot version ${String(version)}`);
  }

  if (!Array.isArray(tabs)) {
    throw new Error('drawer slot tabs must be an array');
  }

  const parsedTabs = tabs.map(parseSerializedDrawerTab);
  const tabIds = new Set(parsedTabs.map((tab) => tab.id));
  if (tabIds.size !== parsedTabs.length) {
    throw new Error('drawer slot contains duplicate tab ids');
  }

  if (focusedId !== null && (typeof focusedId !== 'string' || !tabIds.has(focusedId))) {
    throw new Error('drawer slot focusedId must be null or the id of one of its tabs');
  }

  if (mode !== undefined && mode !== 'minimized' && mode !== 'expanded') {
    throw new Error(`drawer slot has unknown mode ${JSON.stringify(mode)}`);
  }

  if (height !== undefined && (typeof height !== 'number' || !Number.isFinite(height) || height <= 0)) {
    throw new Error('drawer slot height must be a positive number');
  }

  return {
    version: 1,
    tabs: parsedTabs,
    focusedId,
    ...(mode !== undefined && { mode }),
    ...(height !== undefined && { height }),
  };
}

/**
 * Builds the slot to save. Pending terminals are left out: their session does
 * not exist yet, so a restored copy could never connect.
 */
export function buildDrawerSlot(
  tabs: BottomDrawerTab[],
  focusedTabId: string | undefined,
  mode: DrawerMode,
  height: number,
): DrawerSlot {
  const savedTabs = tabs.filter((tab) => !isPendingDrawerTab(tab)).map(serializeDrawerTab);
  const focusedId = savedTabs.some((tab) => tab.id === focusedTabId) ? focusedTabId ?? null : null;
  return { version: 1, tabs: savedTabs, focusedId, mode, height };
}

/** Slot for a new panel window that holds a single torn-off or moved tab. */
export function buildPanelDrawerSlot(tab: SerializedDrawerTab): DrawerSlot {
  return { version: 1, tabs: [tab], focusedId: tab.id };
}

/**
 * Ids of drawer tabs owned by windows other than `ownWindowName`, read from the
 * WindowService's `ListStates()` (window -> slot -> JSON). A window whose drawer
 * slot is malformed claims nothing.
 */
export function collectDrawerTabIdsClaimedByOtherWindows(
  statesByWindow: Record<string, Record<string, string | undefined> | undefined>,
  ownWindowName: string,
): Set<string> {
  const claimed = new Set<string>();
  for (const [windowName, slots] of Object.entries(statesByWindow)) {
    const drawerJson = slots?.drawer;
    if (windowName === ownWindowName || !drawerJson) {
      continue;
    }

    try {
      for (const tab of parseDrawerSlot(JSON.parse(drawerJson)).tabs) {
        claimed.add(tab.id);
      }
    } catch (error) {
      console.error(`[drawer] ignoring invalid drawer state of window "${windowName}"`, error);
    }
  }

  return claimed;
}
