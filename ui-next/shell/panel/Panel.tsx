import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import type { Platform } from '../core/chords';
import { limitsOf, resolveHeight } from '../core/panel';
import { usePanel } from './context';
import { PanelBody } from './PanelBody';
import { PanelHeader } from './PanelHeader';
import { useHeight, useOpen, usePanelSelector } from './hooks';
import styles from './Panel.module.css';
import { useSplitter } from './useSplitter';

const subscribeResize = (listener: () => void): (() => void) => {
  window.addEventListener('resize', listener);
  return () => {
    window.removeEventListener('resize', listener);
  };
};

/** The window's height: what the panel's limits and its `aria-valuenow` are read against. It changes when the window is resized, and for nothing else. */
const useViewportHeight = (): number => useSyncExternalStore(subscribeResize, () => window.innerHeight, () => 0);

type PanelProps = { readonly platform: Platform };

/**
 * The bottom panel (ch16 section H) and its splitter: two items of the window's grid, the 5 px gutter above and the region below it. The region is hidden, not unmounted, when the panel is
 * closed (`display: none`: no layout, no paint, and the bodies of its sessions stay mounted and keep streaming); a closed panel draws no handle. The region's height is the stylesheet's:
 * the default, or the one custom property `--_size` that holds what the user chose. See `./splitter.ts` for what a drag costs.
 */
export function Panel({ platform }: PanelProps) {
  const { store } = usePanel();
  const ids = useId();
  const prefix = `${ids}-panel`;
  const deck = `${ids}-deck`;
  const panelId = `${ids}-region`;
  const element = useRef<HTMLElement>(null);
  const open = useOpen();
  const maximized = usePanelSelector((state) => state.maximized);
  const height = useHeight();
  const viewport = useViewportHeight();
  // The mock re-clamps what it stored on load and on every resize of the window (S103): a size that does not fit the window is brought within it for good, and when the window grows
  // again the panel stays as small as it was made. The effect runs when the panel mounts, which is the load, and when the window's height changes, which is the resize; a size that fits changes nothing.
  useEffect(() => {
    store.fitHeight(viewport);
  }, [store, viewport]);
  const splitter = useSplitter(element, height, open);
  const { min, max } = limitsOf(viewport);
  const size = Math.round(resolveHeight(height, viewport));
  return (
    <>
      {open && !maximized ? (
        <div
          className={styles.handle}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel"
          aria-controls={panelId}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={size}
          aria-valuetext={`Panel ${String(size)} pixels`}
          tabIndex={0}
          data-shell-part="panelHandle"
          onPointerDown={splitter.pointerDown}
          onPointerMove={splitter.pointerMove}
          onPointerUp={splitter.pointerUp}
          onPointerCancel={splitter.cancel}
          onLostPointerCapture={splitter.cancel}
          onKeyDown={splitter.key}
          onDoubleClick={splitter.reset}
        />
      ) : null}
      <section
        ref={element}
        id={panelId}
        className={styles.panel}
        hidden={!open}
        data-maximized={maximized ? '' : undefined}
        aria-label="Panel"
        data-shell-region="panel"
        data-ov-menu-scope=""
        data-shell-part="panel"
        style={{ '--_size': height === null ? undefined : `${String(height)}px` }}
      >
        <PanelHeader prefix={prefix} controls={deck} maximized={maximized} platform={platform} />
        <PanelBody prefix={prefix} id={deck} />
      </section>
    </>
  );
}
