import './wdyr';

import 'systemjs/dist/system';
import 'systemjs/dist/extras/amd';
import 'systemjs/dist/extras/named-register.js';

import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.querySelector('#root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
