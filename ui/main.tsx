import "./features/logger/patchConsole";
import '@omniviewdev/ui/theme/tokens.css';

import 'systemjs/dist/system.js';
import 'systemjs/dist/extras/amd.js';
import 'systemjs/dist/extras/named-register.js';

import App from './App';

import { createRoot } from "react-dom/client";

const container = document.getElementById("root") as HTMLElement;
const root = createRoot(container);

root.render(<App />)

