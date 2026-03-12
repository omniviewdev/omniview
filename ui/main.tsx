import '@omniviewdev/ui/theme/tokens.css';

import 'systemjs/dist/system.js';
import 'systemjs/dist/extras/amd.js';
import 'systemjs/dist/extras/named-register.js';

import { DiagnosticsClient } from '@omniviewdev/runtime/api';
import { initTelemetry, type LogSink } from './features/telemetry';

// Bridge frontend telemetry to the existing DiagnosticsClient.Log Wails binding.
const bridgeSink: LogSink = {
  write(level, msg, fields) {
    DiagnosticsClient.Log(level, msg, fields).catch(() => {});
  },
};

initTelemetry(bridgeSink);

import App from './App';
import { createRoot } from "react-dom/client";

const container = document.getElementById("root") as HTMLElement;
const root = createRoot(container);

root.render(<App />)

