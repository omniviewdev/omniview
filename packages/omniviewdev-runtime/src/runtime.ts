// Import generated event type augmentations and runtime constructors.
// eventdata.d.ts augments @wailsio/runtime's CustomEvents interface so
// Events.On("plugin/state_change", ...) has fully typed ev.data.
// eventcreate.ts registers runtime deserializers for event payloads.
import './bindings/github.com/wailsapp/wails/v3/internal/eventcreate';
/// <reference path="./bindings/github.com/wailsapp/wails/v3/internal/eventdata.d.ts" />

export {
  Application,
  Browser,
  Call,
  Clipboard,
  Dialogs,
  Events,
  Flags,
  Screens,
  System,
  Window,
  WML,
} from '@wailsio/runtime';
