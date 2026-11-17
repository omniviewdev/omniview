// SystemJS, with the named-register extra: the mechanism every first-party plugin build already targets (`format: 'system'`), and the one the old shell loads
// them with (ui/features/plugins/api/systemjs.ts). Importing this file defines the global `System`. The loader imports it lazily, so a screen that
// loads no plugin never pays for it.
import 'systemjs/dist/system.js';
import 'systemjs/dist/extras/named-register.js';

export const systemJs = System;
