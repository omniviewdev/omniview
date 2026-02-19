// Auto-generated shim for '@omniviewdev/runtime/runtime'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/runtime/runtime'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/runtime/runtime" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const BrowserOpenURL = mod.BrowserOpenURL;
export const CanResolveFilePaths = mod.CanResolveFilePaths;
export const ClipboardGetText = mod.ClipboardGetText;
export const ClipboardSetText = mod.ClipboardSetText;
export const Environment = mod.Environment;
export const EventsEmit = mod.EventsEmit;
export const EventsOff = mod.EventsOff;
export const EventsOn = mod.EventsOn;
export const EventsOnMultiple = mod.EventsOnMultiple;
export const EventsOnce = mod.EventsOnce;
export const Hide = mod.Hide;
export const LogDebug = mod.LogDebug;
export const LogError = mod.LogError;
export const LogFatal = mod.LogFatal;
export const LogInfo = mod.LogInfo;
export const LogPrint = mod.LogPrint;
export const LogTrace = mod.LogTrace;
export const LogWarning = mod.LogWarning;
export const OnFileDrop = mod.OnFileDrop;
export const OnFileDropOff = mod.OnFileDropOff;
export const Quit = mod.Quit;
export const ResolveFilePaths = mod.ResolveFilePaths;
export const ScreenGetAll = mod.ScreenGetAll;
export const Show = mod.Show;
export const WindowCenter = mod.WindowCenter;
export const WindowFullscreen = mod.WindowFullscreen;
export const WindowGetPosition = mod.WindowGetPosition;
export const WindowGetSize = mod.WindowGetSize;
export const WindowHide = mod.WindowHide;
export const WindowIsFullscreen = mod.WindowIsFullscreen;
export const WindowIsMaximised = mod.WindowIsMaximised;
export const WindowIsMinimised = mod.WindowIsMinimised;
export const WindowIsNormal = mod.WindowIsNormal;
export const WindowMaximise = mod.WindowMaximise;
export const WindowMinimise = mod.WindowMinimise;
export const WindowReload = mod.WindowReload;
export const WindowReloadApp = mod.WindowReloadApp;
export const WindowSetAlwaysOnTop = mod.WindowSetAlwaysOnTop;
export const WindowSetBackgroundColour = mod.WindowSetBackgroundColour;
export const WindowSetDarkTheme = mod.WindowSetDarkTheme;
export const WindowSetLightTheme = mod.WindowSetLightTheme;
export const WindowSetMaxSize = mod.WindowSetMaxSize;
export const WindowSetMinSize = mod.WindowSetMinSize;
export const WindowSetPosition = mod.WindowSetPosition;
export const WindowSetSize = mod.WindowSetSize;
export const WindowSetSystemDefaultTheme = mod.WindowSetSystemDefaultTheme;
export const WindowSetTitle = mod.WindowSetTitle;
export const WindowShow = mod.WindowShow;
export const WindowToggleMaximise = mod.WindowToggleMaximise;
export const WindowUnfullscreen = mod.WindowUnfullscreen;
export const WindowUnmaximise = mod.WindowUnmaximise;
export const WindowUnminimise = mod.WindowUnminimise;

export default mod.default !== undefined ? mod.default : mod;
