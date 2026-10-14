import { configureStore } from '@reduxjs/toolkit';
import headerReducer from './header/slice';

export const store = configureStore({
  reducer: {
    header: headerReducer,
  },
});

// Infer the `RootState` type from the store itself
export type RootState = ReturnType<typeof store.getState>;
