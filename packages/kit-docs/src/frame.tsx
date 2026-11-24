import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MenuHost, ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import '@omniviewdev/kit/styles.css';
import { groups } from '../content/registry';
import type { PreviewReading, PreviewUpdate, TokenValues } from './Preview';

const parent = window.parent;
const origin = window.location.origin;

function ExampleCanvas({ update }: { update: PreviewUpdate }) {
  const { group, name, appearance, overrides, revision, tokenNames } = update;
  const Example = groups[group]?.[name];

  useLayoutEffect(() => {
    // Put overrides on the document root so portals inherit them too.
    const root = document.documentElement;
    const entries = Object.entries(overrides);
    for (const [token, value] of entries) {
      if (value !== undefined) root.style.setProperty(token, value);
    }

    const styles = getComputedStyle(root);
    const values: TokenValues = {};
    for (const token of tokenNames) {
      values[token] = styles.getPropertyValue(token).trim();
    }
    const reading: PreviewReading = { type: 'kit-preview:reading', revision, values };
    parent.postMessage(reading, origin);

    return () => {
      for (const [token] of entries) root.style.removeProperty(token);
    };
  }, [overrides, revision, tokenNames]);

  return (
    <ThemeProvider themeId={appearance.theme} density={appearance.density} textSize={appearance.textSize}>
      <main className="canvas-content">
        <MenuHost>{Example ? <Example key={`${group}/${name}`} /> : <p>Example not found.</p>}</MenuHost>
      </main>
    </ThemeProvider>
  );
}

const root = createRoot(document.getElementById('root')!);

function render(update?: PreviewUpdate) {
  root.render(
    <>
      <TooltipHost />
      {update && <ExampleCanvas update={update} />}
    </>,
  );
}

function handleMessage(event: MessageEvent<PreviewUpdate>) {
  if (event.source === parent && event.origin === origin && event.data?.type === 'kit-preview:update') {
    render(event.data);
  }
}

function cleanup() {
  window.removeEventListener('message', handleMessage);
  window.removeEventListener('pagehide', handlePageHide);
  root.unmount();
}

function handlePageHide(event: PageTransitionEvent) {
  if (!event.persisted) cleanup();
}

// Register before the iframe load event tells the parent to send its first update.
window.addEventListener('message', handleMessage);
window.addEventListener('pagehide', handlePageHide);
import.meta.hot?.dispose(cleanup);
render();
