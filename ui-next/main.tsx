// The kit's stylesheet first: it declares the cascade layer order that every later stylesheet sits in.
import '@omniviewdev/kit/styles.css';
import './global.css';
import { ThemeProvider } from '@omniviewdev/kit';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PodsSkeleton } from './pods/PodsSkeleton';

// `?screen=pods` opens the slice-1a skeleton (docs/ui-next/slices/1a-pods-list.md): the live Pod names from a connection.
// It stays until the real Pods list replaces it.
const screen = new URLSearchParams(window.location.search).get('screen');

createRoot(document.getElementById('root')!).render(
  screen === 'pods' ? (
    <ThemeProvider>
      <PodsSkeleton />
    </ThemeProvider>
  ) : (
    <App />
  ),
);
