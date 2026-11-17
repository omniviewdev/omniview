// The kit's stylesheet first: it declares the cascade layer order that every later stylesheet sits in.
import '@omniviewdev/kit/styles.css';
import './global.css';
import { ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TooltipStress } from './parts/TooltipStress';
import { createQueryClient } from './queryClient';
import { Shell } from './shell';
// SCAFFOLDING(N19): begin
// eslint-disable-next-line kit/scaffold-boundary -- SCAFFOLDING(N19): the one mount point of the Pods slice scaffolding (the page, and its registration for the shell frame); removed with ui-next/k8s/ and ui-next/pods/ (tracker N19)
import { PodsSkeleton, podsShellRegistration } from './pods';

// `?screen=pods` opens the slice-1a skeleton (the slice plan): the live Pod names from a connection, in the shell frame (PR 1a.5).
// `?connection=<id>` names the connection the frame shows in its scope lane and path. It stays until the real Pods list replaces it.
const params = new URLSearchParams(window.location.search);
const screen = params.get('screen');
// SCAFFOLDING(N19): end

// The host owns the one QueryClient; no screen builds its own (docs/ui-next/optimisations.md RTM-14, MNR-D8).
const queryClient = createQueryClient();

function Screen() {
  // SCAFFOLDING(N19): begin
  if (screen === 'pods') {
    // The registration is plain data from the screen's own directory; this is where its shape meets the shell's, and the type checker holds them together.
    return (
      <ThemeProvider>
        <Shell registration={podsShellRegistration(params.get('connection') ?? undefined)}>
          <PodsSkeleton />
        </Shell>
      </ThemeProvider>
    );
  }
  // SCAFFOLDING(N19): end

  if (screen === 'tooltip-stress') {
    // The tooltip's stress page (docs/ui-next/status/1a.4d.md): `n` triggers, with a tip each unless `mode=plain`.
    return (
      <ThemeProvider>
        <TooltipStress count={Number(params.get('n') ?? '1000')} withTips={params.get('mode') !== 'plain'} />
      </ThemeProvider>
    );
  }

  return <App />;
}

// The one tooltip of the window, mounted once beside every screen (the kit's TooltipHost listens on the document for every `tip`).
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <Screen />
    <TooltipHost />
  </QueryClientProvider>,
);
