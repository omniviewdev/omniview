import { configureStore } from '@reduxjs/toolkit'
import tabsReducer from './tabs/slice'
import headerReducer from './header/slice'
import settingsReducer from './settings/slice'

export const store = configureStore({
  reducer: {
    tabs: tabsReducer,
    header: headerReducer,
    settings: settingsReducer,
  },
})

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch
