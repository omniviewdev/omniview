// The kit's stylesheet first: it declares the cascade layer order that every later stylesheet sits in.
import '@omniviewdev/kit/styles.css';
import './global.css';
import { ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ListPage } from './page';
import { TooltipStress } from './parts/TooltipStress';
import { PluginHostScreen } from './plugins';
import { createQueryClient } from './queryClient';
import { Shell } from './shell';
// SCAFFOLDING(N19): begin
// The activity provider is one of the providers a plugin's hooks read through the host (`useConnections` raises notifications through it): `PluginHostScreen`
// mounts it for a contributed page and this mount point does the same, so the Pods code holds none and imports the runtime only through its curated entry.
import { ActivityProvider } from '@omniviewdev/runtime';
// eslint-disable-next-line kit/scaffold-boundary -- SCAFFOLDING(N19): the one mount point of the Pods slice scaffolding (its data and its page definition, for the host's shell frame and list page); removed with ui-next/k8s/ and ui-next/pods/ (tracker N19)
import { PodsPage } from './pods';
// `?screen=pods` opens the Pods list of slice 1a (the slice plan): the live Pods of a connection, in the shell frame (PR 1a.5), on the list page (PR 1a.6).
// `?connection=<id>` names the connection the frame shows in its scope lane and path.
// SCAFFOLDING(N19): end

// The new tree has no navigation of its own yet, so `?screen=` picks the screen. `plugins` is the real one: the pages the installed plugins contribute, opened
// by the plugin's own route (a native window cannot take a parameter; docs/ui-next/slices/n19-plugin-seam.md, 2.3). It becomes the default screen at the flip.
const params = new URLSearchParams(window.location.search);
const screen = params.get('screen');

// The host owns the one QueryClient; no screen builds its own (docs/ui-next/optimisations.md RTM-14, MNR-D8).
const queryClient = createQueryClient();

function Screen() {
  if (screen === 'plugins') {
    return (
      <ThemeProvider>
        <PluginHostScreen />
      </ThemeProvider>
    );
  }

  // SCAFFOLDING(N19): begin
  if (screen === 'pods') {
    // The screen hands the host plain data: how it sits in the frame, what the page lists, and the rows with their state. This is where those shapes meet the
    // shell's and the list page's, and the type checker holds them together.
    return (
      <ThemeProvider>
        <ActivityProvider>
          <PodsPage connection={params.get('connection') ?? undefined}>
            {({ registration, definition, source }) => (
              <Shell registration={registration}>
                <ListPage definition={definition} source={source} />
              </Shell>
            )}
          </PodsPage>
        </ActivityProvider>
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
