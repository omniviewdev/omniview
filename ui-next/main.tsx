// The kit's stylesheet first: it declares the cascade layer order that every later stylesheet sits in.
import '@omniviewdev/kit/styles.css';
import './global.css';
import { ThemeProvider } from '@omniviewdev/kit';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// SCAFFOLDING(N19): begin
// eslint-disable-next-line kit/scaffold-boundary -- SCAFFOLDING(N19): the one mount point of the Pods slice scaffolding; removed with ui-next/k8s/ (tracker N19)
import { PodsSkeleton } from './pods/PodsSkeleton';

// `?screen=pods` opens the slice-1a skeleton (docs/ui-next/slices/1a-pods-list.md): the live Pod names from a connection.
// It stays until the real Pods list replaces it.
const screen = new URLSearchParams(window.location.search).get('screen');
// SCAFFOLDING(N19): end

createRoot(document.getElementById('root')!).render(
  // SCAFFOLDING(N19): begin
  screen === 'pods' ? (
    <ThemeProvider>
      <PodsSkeleton />
    </ThemeProvider>
  // SCAFFOLDING(N19): end
  ) : (
    <App />
  ),
);
