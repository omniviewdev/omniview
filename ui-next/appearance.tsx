import {
  DEFAULT_DENSITY, DEFAULT_TEXT_SIZE, DEFAULT_THEME_ID, DENSITIES, TEXT_SIZES,
  ThemeProvider, type Density, type TextSize,
} from '@omniviewdev/kit';
import { SettingsService, type AppearanceSnapshot } from '@omniviewdev/runtime/api';
import { Events, onEventsReconnect } from '@omniviewdev/runtime/runtime';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type AppearanceSource = {
  readonly read: () => Promise<AppearanceSnapshot>;
  readonly changed: (listener: (revision: number) => void) => () => void;
  readonly reconnect: (listener: () => void) => () => void;
};

const host: AppearanceSource = {
  read: async () => SettingsService.GetAppearance(),
  changed: (listener) => Events.On('appearance/changed', (event) => listener(event.data)),
  reconnect: (listener) => onEventsReconnect(listener),
};

type Capabilities = { readonly glass: boolean; readonly translucent: boolean; readonly forcedOpaque: boolean };
type View = { readonly themeId: string; readonly density: Density; readonly textSize: TextSize; readonly capabilities: Capabilities };
const initial: View = {
  themeId: DEFAULT_THEME_ID, density: DEFAULT_DENSITY, textSize: DEFAULT_TEXT_SIZE,
  capabilities: { glass: false, translucent: true, forcedOpaque: false },
};
const CapabilitiesContext = createContext(initial.capabilities);
export function useAppearanceCapabilities(): Capabilities {
  return useContext(CapabilitiesContext);
}

const solidMedia = '(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)';
const materialAttribute = 'data-ov-material';
const surfaces = [
  ['chromeOpacity', 'data-ov-chrome-opacity'], ['contentOpacity', 'data-ov-content-opacity'],
  ['menuOpacity', 'data-ov-menu-opacity'], ['sheetOpacity', 'data-ov-sheet-opacity'],
] as const;

/** Theme and controls belong in React. Updating one background percentage must not wake either one. */
function viewOf({ preferences: p, material }: AppearanceSnapshot, forcedOpaque: boolean, previous: View): View {
  const capabilities = previous.capabilities;
  const sameCapabilities = capabilities.glass === material.glass && capabilities.translucent === material.translucent && capabilities.forcedOpaque === forcedOpaque;
  if (sameCapabilities && previous.themeId === p.theme && previous.density === p.density && previous.textSize === p.textSize) {
    return previous;
  }

  return {
    themeId: p.theme,
    density: DENSITIES.find((density) => density === p.density) ?? DEFAULT_DENSITY,
    textSize: TEXT_SIZES.find((size) => size === p.textSize) ?? DEFAULT_TEXT_SIZE,
    capabilities: sameCapabilities ? capabilities : { glass: material.glass, translucent: material.translucent, forcedOpaque },
  };
}

function attribute(root: HTMLElement, key: string, value: string) {
  if (root.getAttribute(key) !== value) {
    root.setAttribute(key, value);
  }
}

/** One reader per application window. Only committed snapshots paint the document; Settings owns drafts. */
export function WindowAppearance({ children, source = host }: { readonly children: ReactNode; readonly source?: AppearanceSource }) {
  const [view, setView] = useState(initial);
  const applied = useRef(initial);
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia(solidMedia);
    const attributes = [materialAttribute, ...surfaces.map(([, key]) => key)];
    const prior = attributes.map((key) => [key, root.getAttribute(key)] as const);
    let snapshot: AppearanceSnapshot | undefined;
    let revision = 0;
    let generation = 0;
    let queued = false;
    let live = true;

    const paint = () => {
      if (!snapshot) {
        return;
      }

      const { preferences: p, material } = snapshot;
      const forced = media.matches || material.forcedOpaque || p.theme === 'high-contrast-dark' || p.theme === 'high-contrast-light';
      // No desktop reveal until this window's native backing is ready. Unrecognized modes stay solid.
      const effective = material.effective;
      const mode = !forced && p.windowMaterial !== 'opaque' && (effective === 'translucent' || effective === 'glass' || effective === 'in-page') ? effective : 'opaque';
      attribute(root, materialAttribute, mode);
      for (const [key, name] of surfaces) {
        attribute(root, name, String(p[key]));
      }

      const next = viewOf(snapshot, forced, applied.current);
      if (next !== applied.current) {
        applied.current = next;
        setView(next);
      }
    };

    const refresh = () => {
      generation += 1;
      if (queued || document.hidden) {
        return;
      }

      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!live || document.hidden) {
          return;
        }

        const ticket = generation;
        void source.read().then((next) => {
          if (!live || ticket !== generation || next.revision <= revision) {
            return;
          }

          revision = next.revision;
          snapshot = next;
          paint();
        }, () => {
          // Keep the last committed paints (solid before the first read). Reconnect or showing the window asks again.
        });
      });
    };

    // Subscribe before reading. A reconnect may reach a restarted host whose revisions start again at one.
    const offChange = source.changed((changed) => {
      if (changed > revision) {
        refresh();
      }
    });
    const offReconnect = source.reconnect(() => {
      revision = 0;
      refresh();
    });
    media.addEventListener('change', paint);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    refresh();
    return () => {
      live = false;
      offChange();
      offReconnect();
      media.removeEventListener('change', paint);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      for (const [key, value] of prior) {
        if (value === null) {
          root.removeAttribute(key);
        } else {
          root.setAttribute(key, value);
        }
      }
    };
  }, [source]);

  return (
    <ThemeProvider themeId={view.themeId} density={view.density} textSize={view.textSize}>
      <CapabilitiesContext.Provider value={view.capabilities}>{children}</CapabilitiesContext.Provider>
    </ThemeProvider>
  );
}
