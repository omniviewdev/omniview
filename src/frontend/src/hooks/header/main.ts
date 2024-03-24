import { type HeaderState } from '@/store/header/types';
import { createSelector } from '@reduxjs/toolkit';
import { useSelector } from 'react-redux';

const selectHeader = (state: HeaderState) => state;

/**
 * Get the visibility of the header.
 */
export const useHeaderVisibility = () => useSelector((state: HeaderState) =>
  createSelector(
    [selectHeader],
    header => header.visible,
  )(state),
);

/**
 * Get the visibility of all the header areas.
 */
export const useHeaderAreaVisibilities = () => useSelector((state: HeaderState) =>
  createSelector(
    [selectHeader],
    header => Object.entries(header.areas).reduce<Record<string, boolean>>((acc, area) => {
      acc[area[0]] = area[1].visible;
      return acc;
    }, {}),
  )(state),
);

/**
* Get the types of all the header areas.
*/
export const useHeaderAreaTypes = () => useSelector((state: HeaderState) =>
  createSelector(
    [selectHeader],
    header => Object.entries(header.areas).reduce<Record<string, string>>((acc, area) => {
      acc[area[0]] = area[1].type;
      return acc;
    }, {}),
  )(state),
);

export default {
  useHeaderVisibility,
  useHeaderAreaVisibilities,
  useHeaderAreaTypes,
};

