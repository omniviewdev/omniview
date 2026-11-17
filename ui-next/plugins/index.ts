// The host's side of the plugin seam: what the window mounts to show the pages the installed plugins contribute. Everything else in this directory is
// internal to it; the contract a plugin writes against is `./contract/v1` and the names it may import are `./loader/specifiers`.
export { PluginHostScreen } from './host/PluginHostScreen';
