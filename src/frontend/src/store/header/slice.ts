import { createSlice } from '@reduxjs/toolkit'

// reducers
import mainReducers from './sections/main'
import areaReducers from './sections/area'

// types

// configurations
import { TabsWithSearch } from './configurations'

// Slice
export const slice = createSlice({
  name: 'header',
  initialState: TabsWithSearch,
  reducers: {
    // Main Header Reducers
    ...mainReducers,
    // Area Specific Reducers
    ...areaReducers,
  },
})

// Action creators are generated for each case reducer function
export const { ...actions } = slice.actions
export default slice.reducer
