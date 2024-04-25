import { type PayloadAction } from '@reduxjs/toolkit';
import { type HeaderAreaItem, type HeaderState } from '../types';
import { configurations } from '../configurations';

/**
 * Set the visibility of the header.
 * @param state - The current state.
 * @param action - The action payload.
 */
const setHeaderVisibility = (state: HeaderState, action: PayloadAction<boolean>) => {
  state.visible = action.payload;
};

/**
 * Toggles the visibility of the header to the opposite of the current visibility.
 * @param state - The current state.
 * @param action - The action payload.
 */
const toggleHeaderVisibility = (state: HeaderState) => {
  state.visible = !state.visible;
};

/**
 * Sets a preset configuration for the header, optionally taking any items defined in another section
 * of the header state and moving them to the specified area.
 */
const setHeaderPreset = (state: HeaderState, action: PayloadAction<{ configuration: keyof typeof configurations; items?: Record<string, HeaderAreaItem[]> }>) => {
  const { configuration, items } = action.payload;
  const config = configurations[configuration];

  if (!config) {
    console.error(`Attempted to set a header configuration that does not exist. Configuration: ${configuration}`);
    return;
  }

  state.areas = config.areas;

  // Find which area is an item display area and move items to that area
  Object.entries(state.areas).forEach(([area, areaConfig]) => {
    if (areaConfig.type === 'items' && items?.[area]) {
      areaConfig.items = items[area];
    }
  });
};

// ==================================== SELECTORS ========================================= //

/**
 * Get the visibility of the header.
 */
export const getHeaderVisibility = (state: HeaderState) => state.visible;

/**
 * Get the visibility of all the header areas.
 */
export const getHeaderAreaVisibilities = (state: HeaderState) => Object.entries(state.areas).reduce<Record<string, boolean>>((acc, area) => {
  acc[area[0]] = area[1].visible;
  return acc;
}, {});

/**
 * Get the types of all the header areas.
 */
export const getHeaderAreaTypes = (state: HeaderState) => Object.entries(state.areas).reduce<Record<string, string>>((acc, area) => {
  acc[area[0]] = area[1].type;
  return acc;
}, {});

export default {
  setHeaderVisibility,
  toggleHeaderVisibility,
  setHeaderPreset,
};
