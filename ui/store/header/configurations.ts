import { type HeaderAreaItemList, HeaderAreaItemType, type HeaderState } from './types';

const defaultItems: HeaderAreaItemList = [
  {
    id: 'home', type: HeaderAreaItemType.LINK, icon: 'LuHouse', href: '/',
  },
  {
    id: 'settings', type: HeaderAreaItemType.LINK, icon: 'LuSettings', href: '/settings',
  },
  {
    id: 'plugins', type: HeaderAreaItemType.LINK, icon: 'LuUnplug', href: '/plugins',
  },
];

/**
 * Show the header with tabs to the left, search in the middle, and items on the right.
 */
export const TabsWithSearch: HeaderState = {
  areas: {
    left: {
      visible: true,
      type: 'tabs',
      items: [],
    },
    center: {
      visible: true,
      type: 'search',
      items: [],
    },
    right: {
      visible: true,
      type: 'items',
      items: defaultItems,
    },
  },
};
