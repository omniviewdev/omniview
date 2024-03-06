import { HeaderState } from '@/store/header/types'
import { createSelector } from '@reduxjs/toolkit'
import { useSelector } from 'react-redux';

const selectHeader = (state: HeaderState) => state;

/**
 * Get the visibility of the header.
 */
export const useHeaderVisibility = () => {
  return useSelector((state: HeaderState) =>
    createSelector(
      [selectHeader],
      header => header.visible
    )(state)
  );
}

/**
 * Get the visibility of all the header areas.
 */
export const useHeaderAreaVisibilities = () => {
  return useSelector((state: HeaderState) =>
    createSelector(
      [selectHeader],
      header => Object.entries(header.areas).reduce((acc, area) => {
        acc[area[0]] = area[1].visible
        return acc;
      }, {} as Record<string, boolean>)
    )(state)
  );
}


/**
* Get the types of all the header areas.
*/
export const useHeaderAreaTypes = () => {
  return useSelector((state: HeaderState) =>
    createSelector(
      [selectHeader],
      header => Object.entries(header.areas).reduce((acc, area) => {
        acc[area[0]] = area[1].type
        return acc;
      }, {} as Record<string, string>)
    )(state)
  );
}

export default {
  useHeaderVisibility,
  useHeaderAreaVisibilities,
  useHeaderAreaTypes,
}


