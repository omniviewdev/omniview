// Imported first so its timestamp marks the start of frontend evaluation.
import './features/perf/startup';

import './theme/base-ui.css';

import 'systemjs/dist/system.js';
import 'systemjs/dist/extras/amd.js';
import 'systemjs/dist/extras/named-register.js';

import { initTelemetry } from './features/telemetry';
import { bridgeSink } from './features/telemetry/bridgeSink';

initTelemetry(bridgeSink);

import App from './App';
import { createRoot } from 'react-dom/client';
import { loadInitialWindowState, resolveCurrentWindow } from './features/windows';

const container = document.getElementById('root')!;
const root = createRoot(container);

// The window identity and its restored tabs must be in place on the first
// render; a failure is reported and the window starts with its default layout.
resolveCurrentWindow()
  .then(loadInitialWindowState)
  .catch((error: unknown) => {
    console.error('[windows] failed to restore this window', error); 
  })
  .finally(() => {
    root.render(<App />); 
  });

