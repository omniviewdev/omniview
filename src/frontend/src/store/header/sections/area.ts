import { PayloadAction, createSelector } from '@reduxjs/toolkit'
import { HeaderAreaItem, HeaderAreaType, HeaderAreaLocation, HeaderState, HeaderAreaItemList } from '../types'
import { useSelector } from 'react-redux';

// ======================================== REDUCERS ======================================== //

/**
* Set the visibility of an area.
*
* @param state - The current state.
* @param action - The action payload.
*/
export const setHeaderAreaVisibility = (state: HeaderState, action: PayloadAction<{ area: HeaderAreaLocation, visible: boolean }>) => {
  const { area, visible } = action.payload;
  state.areas[area].visible = visible;
}

/**
* Toggles the visibility of the left area of the header to the opposite of the current visibility.
*
* @param state - The current state. 
* @param action - The action payload.
*/
export const toggleHeaderAreaVisibility = (state: HeaderState, action: PayloadAction<{ area: HeaderAreaLocation }>) => {
  const { area } = action.payload;
  state.areas[area].visible = !state.areas[area].visible;
}

/**
 * Sets the type of header content for an area.
 *
 * @param state - The current state.
 * @param action - The action payload.
 */
export const setHeaderAreaType = (state: HeaderState, action: PayloadAction<{ area: HeaderAreaLocation, type: HeaderAreaType }>) => {
  const { area, type } = action.payload;

  // ensure that no other header areas are of the same type
  for (const [areaKey, areaValue] of Object.entries(state.areas)) {
    if (areaKey !== area && areaValue.type === type) {
      console.error(`Attempted to set the type of a header area to a type that already exists in another area. Area: ${area}, Type: ${type}`)
      return
    }
  }

  state.areas[area].type = type;
}

/**
 * Sets the items for a header area. If any items already exist, they will be replaced.
 *
 * @param area - The area to set items for.
 * @param state - The current state.
 * @param action - The list of items to set to the header area.
 */
export const setHeaderAreaItems = (state: HeaderState, action: PayloadAction<{ area: HeaderAreaLocation, items: HeaderAreaItem[] }>) => {
  const { area, items } = action.payload;
  // if the header area type isn't 'items' then we don't want to set the items
  if (state.areas[area].type !== 'items') {
    console.error(`Attempted to set items on a header area that is not of type "items". Area: ${area}`)
    return
  }
  state.areas[area].items = items;
}

/**
 * Adds items to a header area. If an item already exists, it will not be replaced.
 *
 * @param area - The area to set items for.
 * @param state - The current state.
 * @param action - The list of items to add to the header area.
 */
export const addHeaderAreaItems = (state: HeaderState, action: PayloadAction<{ area: HeaderAreaLocation, items: HeaderAreaItemList, replace?: boolean }>) => {
  const { area, replace, items } = action.payload

  // if the header area type isn't 'items' then we don't want to set the items
  if (state.areas[area].type !== 'items') {
    console.error(`Attempted to add items to a header area that is not of type "items". Area: ${area}`)
    return
  }

  // Ensure items array exists
  if (state.areas[area].items === undefined) {
    state.areas[area].items = [];
  }

  // Now that TypeScript is assured `items` is defined, proceed with your logic
  for (const item of items) {
    const existingItemIndex = state.areas[area].items?.findIndex((i) => i.id === item.id) || -1;

    if (existingItemIndex === -1) {
      /*@ts-ignore*/ // <-- typescript is being weird about this line since we check above
      state.areas[area].items.push(item);
    } else if (replace) {
      /*@ts-ignore*/ // <-- typescript is being weird about this line since we check above
      state.areas[area].items[existingItemIndex] = item;
    } else {
      console.error(`Attempted to add an item to a header area that already exists. Area: ${area}, Item: ${item.id}`);
    }
  }
}

/**
 * Removes items from a header area. If an item doesn't exist, it will be ignored.
 *
 * @param area - The area to remove items from.
 * @param state - The current state.
 * @param action - The list of item ids to remove from the header area.
 */
export const removeHeaderAreaItems = (state: HeaderState, action: PayloadAction<{ area: HeaderAreaLocation, ids: string[] }>) => {
  const { area, ids } = action.payload
  state.areas[area].items = state.areas[area]?.items?.filter((i) => !ids.includes(i.id))
}

// ==================================== SELECTORS ========================================= //

// helper selector to get by area
const selectHeaderAreas = (state: HeaderState) => state.areas;

/**
 * Retrieves all header areas
 */
export const useHeaderAreas = () => {
  return useSelector((state: HeaderState) =>
    createSelector(
      [selectHeaderAreas],
      areaState => areaState
    )(state)
  );
}

/**
 * Retreives a single header area.
 */
export const useHeaderArea = (area: HeaderAreaLocation) => {
  return useSelector((state: HeaderState) =>
    createSelector(
      [selectHeaderAreas],
      areaState => areaState[area]
    )(state)
  );
};

/**
 * Retrieves the visibility of a header area.
 */
export const useHeaderAreaVisibility = (area: HeaderAreaLocation) => {
  return useSelector((state: HeaderState) =>
    createSelector(
      [selectHeaderAreas],
      areaState => areaState[area].visible
    )(state)
  );
};

/**
 * Retrieves the type of a header area.
 */
export const useHeaderAreaType = (area: HeaderAreaLocation) => {
  return useSelector((state: HeaderState) =>
    createSelector(
      [selectHeaderAreas],
      areaState => areaState[area].type
    )(state)
  );
};

/**
 * Retrieves all items for a header area.
 */
export const useHeaderAreaItems = (area: HeaderAreaLocation) => {
  return useSelector((state: HeaderState) =>
    createSelector(
      [selectHeaderAreas],
      areaState => areaState[area].items
    )(state)
  );
};

/**
 * Retrieves a single header area item by id.
 */
export const useHeaderAreaItem = (area: HeaderAreaLocation, id: string) => {
  return useSelector((state: HeaderState) =>
    createSelector(
      [selectHeaderAreas],
      areaState => areaState[area].items?.find((i) => i.id === id)
    )(state)
  );
};


export default {
  toggleHeaderAreaVisibility,
  setHeaderAreaVisibility,
  setHeaderAreaType,
  setHeaderAreaItems,
  addHeaderAreaItems,
  removeHeaderAreaItems,
}


