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

const container = document.getElementById('root')!;
const root = createRoot(container);

root.render(<App />);

