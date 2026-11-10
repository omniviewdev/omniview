// Imported first so its timestamp marks the start of frontend evaluation.
import './features/perf/startup';
import './providers/monaco/bootstrap';

import './theme/base-ui.css';

import 'systemjs/dist/system.js';
import 'systemjs/dist/extras/amd.js';
import 'systemjs/dist/extras/named-register.js';

import { initTelemetry } from './features/telemetry';
import { bridgeSink } from './features/telemetry/bridgeSink';
import { initTracing } from './features/telemetry/tracing';
import { SpanStatusCode } from '@opentelemetry/api';

const startupSpan = initTracing('unknown').getTracer('omniview.frontend').startSpan('frontend.startup');

initTelemetry(bridgeSink);
// Measure interaction-to-next-frame without recording event targets or content.
document.addEventListener('click', () => {
  const span = initTracing('unknown').getTracer('omniview.frontend').startSpan('frontend.interaction');
  requestAnimationFrame(() => {
    span.end(); 
  });
}, { capture: true, passive: true });

import App from './App';
import { createRoot } from 'react-dom/client';
import { loadInitialWindowState, resolveCurrentWindow } from './features/windows';

const container = document.getElementById('root')!;
const root = createRoot(container);

// Identity must resolve before shell selection. State restoration can fall back
// to empty tabs; a failed identity must never mount a second workspace shell.
resolveCurrentWindow()
  .then(async () => {
    try {
      await loadInitialWindowState();
    } catch (error: unknown) {
      console.error('[windows] failed to restore window state', error);
    }

    root.render(<App />);
    startupSpan.end();
  })
  .catch((error: unknown) => {
    startupSpan.setStatus({ code: SpanStatusCode.ERROR });
    startupSpan.end();
    console.error('[windows] failed to identify this window', error);
    root.render(<p role='alert'>Could not identify this application window. Reload to try again.</p>);
  });

