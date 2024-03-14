import { HeaderAreaItemList, HeaderAreaItemType, HeaderState } from "./types";

// Various configurations for how the header should look. This includes combinations of areas and types to display.
const defaultItems: HeaderAreaItemList = [
  { id: 'home', type: HeaderAreaItemType.LINK, icon: 'LuHome', href: '/' },
  { id: 'settings', type: HeaderAreaItemType.LINK, icon: 'LuSettings', href: '/settings' },
  { id: 'plugins', type: HeaderAreaItemType.LINK, icon: 'LuUnplug', href: '/plugins' },
];
/**
 * Show the header with a context badge on the left, and a search bar in the center and items on the right.
 */
export const ContextWithSearch: HeaderState = {
  visible: true,
  areas: {
    left: {
      visible: true,
      type: 'context',
      items: []
    },
    center: {
      visible: true,
      type: 'search',
      items: []
    },
    right: {
      visible: true,
      type: 'items',
      items: defaultItems,
    }
  }
}

/**
 * Show the header with tabs on the left and items on the right.
 */
export const TabsWithItems: HeaderState = {
  visible: true,
  areas: {
    left: {
      visible: true,
      type: 'tabs',
      items: []
    },
    center: {
      visible: false,
      type: 'search',
      items: []
    },
    right: {
      visible: true,
      type: 'items',
      items: defaultItems,
    }
  }
}

/**
 * Show the header with tabs to the left, search in the middle, and items on the right.
 */
export const TabsWithSearch: HeaderState = {
  visible: true,
  areas: {
    left: {
      visible: true,
      type: 'tabs',
      items: []
    },
    center: {
      visible: true,
      type: 'search',
      items: []
    },
    right: {
      visible: true,
      type: 'items',
      items: defaultItems,
    }
  }
}

export const configurations: Record<string, HeaderState> = {
  'ContextWithSearch': ContextWithSearch,
  'TabsWithItems': TabsWithItems,
}


export default {
  ContextWithSearch,
  TabsWithItems,
}
