// The kit's stylesheet first: it declares the cascade layer order that every later stylesheet sits in.
import '@omniviewdev/kit/styles.css';
import './global.css';
import { ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TooltipStress } from './parts/TooltipStress';
import { PluginHostScreen } from './plugins';
import { createQueryClient } from './queryClient';

// What the window shows comes from the plugins: with no parameter and no hash it opens the first page a loaded plugin contributes, and a plugin names its own
// route (a native window cannot take a parameter; docs/ui-next/slices/n19-plugin-seam.md, 2.2). `?screen=` picks one of the host's own pages, which exist for
// development: `parts` (every kit part in every state it has an example for) and `tooltip-stress`.
const params = new URLSearchParams(window.location.search);
const screen = params.get('screen');

// The host owns the one QueryClient; no screen builds its own (docs/ui-next/optimisations.md RTM-14, MNR-D8).
const queryClient = createQueryClient();

function Screen() {
  if (screen === 'parts') {
    return <App />;
  }

  if (screen === 'tooltip-stress') {
    // The tooltip's stress page (docs/ui-next/status/1a.4d.md): `n` triggers, with a tip each unless `mode=plain`.
    return (
      <ThemeProvider>
        <TooltipStress count={Number(params.get('n') ?? '1000')} withTips={params.get('mode') !== 'plain'} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <PluginHostScreen />
    </ThemeProvider>
  );
}

// The one tooltip of the window, mounted once beside every screen (the kit's TooltipHost listens on the document for every `tip`).
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <Screen />
    <TooltipHost />
  </QueryClientProvider>,
);
