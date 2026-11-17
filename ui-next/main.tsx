// The kit's stylesheet first: it declares the cascade layer order that every later stylesheet sits in.
import '@omniviewdev/kit/styles.css';
import './global.css';
import { ThemeProvider } from '@omniviewdev/kit';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createQueryClient } from './queryClient';
// SCAFFOLDING(N19): begin
// eslint-disable-next-line kit/scaffold-boundary -- SCAFFOLDING(N19): the one mount point of the Pods slice scaffolding; removed with ui-next/k8s/ (tracker N19)
import { PodsSkeleton } from './pods/PodsSkeleton';

// `?screen=pods` opens the slice-1a skeleton (docs/ui-next/slices/1a-pods-list.md): the live Pod names from a connection.
// It stays until the real Pods list replaces it.
const screen = new URLSearchParams(window.location.search).get('screen');
// SCAFFOLDING(N19): end

// The host owns the one QueryClient; no screen builds its own (docs/ui-next/optimisations.md RTM-14, MNR-D8).
const queryClient = createQueryClient();

function Screen() {
  // SCAFFOLDING(N19): begin
  if (screen === 'pods') {
    return (
      <ThemeProvider>
        <PodsSkeleton />
      </ThemeProvider>
    );
  }
  // SCAFFOLDING(N19): end

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <Screen />
  </QueryClientProvider>,
);
