import { createSelector } from '@reduxjs/toolkit';
import { type HeaderAreaLocation, type HeaderState } from '@/store/header/types';
import { useSelector } from 'react-redux';

// Helper selector to get by area
const selectHeaderAreas = (state: HeaderState) => state.areas;

/**
 * Retrieves all header areas
 */
export const useHeaderAreas = () => useSelector((state: HeaderState) =>
  createSelector(
    [selectHeaderAreas],
    areaState => areaState,
  )(state),
);

/**
 * Retreives a single header area.
 */
export const useHeaderArea = (area: HeaderAreaLocation) => useSelector((state: HeaderState) =>
  createSelector(
    [selectHeaderAreas],
    areaState => areaState[area],
  )(state),
);

/**
 * Retrieves the visibility of a header area.
 */
export const useHeaderAreaVisibility = (area: HeaderAreaLocation) => useSelector((state: HeaderState) =>
  createSelector(
    [selectHeaderAreas],
    areaState => areaState[area].visible,
  )(state),
);

/**
 * Retrieves the type of a header area.
 */
export const useHeaderAreaType = (area: HeaderAreaLocation) => useSelector((state: HeaderState) =>
  createSelector(
    [selectHeaderAreas],
    areaState => areaState[area].type,
  )(state),
);

/**
 * Retrieves all items for a header area.
 */
export const useHeaderAreaItems = (area: HeaderAreaLocation) => useSelector((state: HeaderState) =>
  createSelector(
    [selectHeaderAreas],
    areaState => areaState[area].items,
  )(state),
);

/**
 * Retrieves a single header area item by id.
 */
export const useHeaderAreaItem = (area: HeaderAreaLocation, id: string) => useSelector((state: HeaderState) =>
  createSelector(
    [selectHeaderAreas],
    areaState => areaState[area].items?.find(i => i.id === id),
  )(state),
);

export default {
  useHeaderAreas,
  useHeaderArea,
  useHeaderAreaVisibility,
  useHeaderAreaType,
  useHeaderAreaItems,
  useHeaderAreaItem,
};

