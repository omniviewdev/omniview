import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { Hotkey, IconButton, Menu } from '@omniviewdev/base-ui';
import { LuPlus } from 'react-icons/lu';

import HintTooltip from '@/components/base/HintTooltip';
import Icon from '@/components/icons/Icon';
import { IsImage } from '@/utils/url';
import { useActivePageNavigation } from '../activePageNavigation';
import { isTerminalTarget } from '../keyboard';
import { HOME_PATH } from '../pagePaths';
import { pluginHomePath, useNewTabPlugins, type NewTabPlugin } from './newTabPlugins';
import { dispositionFor, openPath, type OpenDisposition } from './openDisposition';
import styles from './NewTabLauncher.module.css';

const MIDDLE_BUTTON = 1;
const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
const MOD = isMac ? 'Meta' : 'Control';

type HeldModifiers = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };
const NO_MODIFIERS: HeldModifiers = { shiftKey: false, metaKey: false, ctrlKey: false };

const actionLabels: Record<OpenDisposition, string> = {
  tab: 'Open',
  background: 'Background tab',
  window: 'New window',
};

function PluginIcon({ plugin, size }: { plugin: NewTabPlugin; size: number }) {
  return IsImage(plugin.icon)
    ? <img src={plugin.icon} alt='' width={size} height={size} className={styles.Image} />
    : <Icon name={plugin.icon || 'LuPuzzle'} size={size} />;
}

/**
 * The header's "+" button. With several plugins it drops down a menu of the
 * plugins that have pages; with one it opens that plugin directly; with none it
 * opens Home. The plugin opens on its home page in a new tab, a background tab
 * (Cmd/Ctrl or middle click) or a new window (Shift). Cmd/Ctrl+T does the same
 * as a click; arrows, type-ahead and Enter work inside the menu.
 */
export function NewTabLauncher({ className }: { className?: string }) {
  const navigation = useActivePageNavigation();
  const plugins = useNewTabPlugins();
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState<HeldModifiers>(NO_MODIFIERS);
  // Enter activates a menu item through a synthetic click without modifier keys.
  const enterModifiers = useRef<HeldModifiers | null>(null);
  const items = useRef(new Map<string, HTMLElement>());

  const only = plugins?.length === 1 ? plugins[0] : undefined;
  const label = only ? `New ${only.name} tab` : 'New tab';
  // The whole first segment; the palette opens plugin pages with an encoded ID.
  const activeSegment = (/^\/_plugin\/([^/?#]+)/.exec(navigation.pathname))?.[1];
  const activePluginId = plugins?.find(({ id }) => id === activeSegment || encodeURIComponent(id) === activeSegment)?.id;

  const openPlugin = (plugin: NewTabPlugin, disposition: OpenDisposition) => {
    setOpen(false);
    openPath(navigation, pluginHomePath(plugin.id), disposition);
  };

  const launch = (disposition: OpenDisposition) => {
    // Until the inventory loads, "no plugins" would wrongly mean Home.
    if (plugins === undefined) {
      return;
    }

    if (plugins.length === 0) {
      openPath(navigation, HOME_PATH, disposition);
    } else if (only) {
      openPlugin(only, disposition);
    } else {
      setOpen((current) => !current);
    }
  };

  const launchFromShortcut = useEffectEvent(() => {
    launch('tab');
  });

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey ||
        !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 't' || isTerminalTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      launchFromShortcut();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // The highlighted row names what Enter will do with the modifier keys held now. Listen in
  // the capture phase, ahead of any handler inside the menu that stops propagation.
  useEffect(() => {
    if (!open) {
      return;
    }

    // WebKitGTK reports a modifier's own keydown before its flag is set (Shift down: shiftKey false).
    const track = (event: globalThis.KeyboardEvent) => {
      const down = event.type === 'keydown';
      setHeld({
        shiftKey: event.key === 'Shift' ? down : event.shiftKey,
        metaKey: event.key === 'Meta' ? down : event.metaKey,
        ctrlKey: event.key === 'Control' ? down : event.ctrlKey,
      });
    };

    window.addEventListener('keydown', track, true);
    window.addEventListener('keyup', track, true);
    return () => {
      window.removeEventListener('keydown', track, true);
      window.removeEventListener('keyup', track, true);
      setHeld(NO_MODIFIERS);
    };
  }, [open]);

  const choose = (plugin: NewTabPlugin, event: MouseEvent) => {
    // A keyboard-activated click has detail 0; its modifiers come from the Enter key.
    const modifiers = event.detail === 0 && enterModifiers.current ? enterModifiers.current : event;
    enterModifiers.current = null;
    openPlugin(plugin, dispositionFor(modifiers));
  };

  const rememberEnterModifiers = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      enterModifiers.current = { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
    }
  };

  const tooltip = <span className={styles.Tooltip}>{label}<Hotkey size='sm' keys={[MOD, 'T']} /></span>;
  const buttonClass = [styles.Trigger, className].filter(Boolean).join(' ');

  if (plugins === undefined || plugins.length < 2) {
    return (
      <HintTooltip content={tooltip}>
        <IconButton
          size='sm'
          variant='soft'
          color='neutral'
          className={buttonClass}
          disabled={plugins === undefined}
          aria-label={label}
          aria-keyshortcuts={`${MOD}+T`}
          onClick={(event) => {
            launch(dispositionFor(event));
          }}
          onAuxClick={(event) => {
            if (event.button === MIDDLE_BUTTON) {
              launch(dispositionFor(event, true));
            }
          }}
        >
          <LuPlus size={15} />
        </IconButton>
      </HintTooltip>
    );
  }

  const action = actionLabels[dispositionFor(held)];
  return (
    <Menu.Root
      open={open}
      onOpenChange={(next, details) => {
        // Shift-click on "+" opens the menu with Shift already held.
        const trigger = details.event;
        if (next && (trigger instanceof globalThis.MouseEvent || trigger instanceof globalThis.KeyboardEvent)) {
          setHeld({ shiftKey: trigger.shiftKey, metaKey: trigger.metaKey, ctrlKey: trigger.ctrlKey });
        }

        setOpen(next);
      }}
      onOpenChangeComplete={(isOpen) => {
        // Start on the plugin of the active tab, so Cmd+T, Enter opens another tab of the same kind.
        const current = activePluginId ? items.current.get(activePluginId) : undefined;
        if (isOpen && current && !current.contains(document.activeElement)) {
          current.focus();
        }
      }}
    >
      <HintTooltip content={tooltip} disabled={open}>
        <Menu.Trigger
          render={
            <IconButton
              size='sm'
              variant='soft'
              color='neutral'
              className={buttonClass}
              aria-label={label}
              aria-keyshortcuts={`${MOD}+T`}
            >
              <LuPlus size={15} />
            </IconButton>
          }
        />
      </HintTooltip>
      <Menu.Portal>
        <Menu.Positioner align='start' sideOffset={6}>
          <Menu.Popup className={styles.Popup} aria-label='New tab' onKeyDownCapture={rememberEnterModifiers}>
            <div className={styles.Heading} aria-hidden='true'>
              <span>New tab</span>
              <Hotkey size='sm' keys={[MOD, 'T']} />
            </div>
            {plugins.map((plugin, index) => (
              <Menu.Item
                key={plugin.id}
                ref={(element: HTMLElement | null) => {
                  if (element) {
                    items.current.set(plugin.id, element);
                  } else {
                    items.current.delete(plugin.id);
                  }
                }}
                label={plugin.name}
                className={styles.Item}
                style={{ '--NewTabLauncher-index': index } as CSSProperties}
                startDecorator={<span className={styles.ItemIcon}><PluginIcon plugin={plugin} size={15} /></span>}
                endDecorator={
                  <span className={styles.ItemHint}>
                    <Hotkey size='sm' className={styles.Letter}>{plugin.name.charAt(0).toUpperCase()}</Hotkey>
                    <span className={styles.Action}>{action}</span>
                  </span>
                }
                onClick={(event) => {
                  choose(plugin, event);
                }}
                onAuxClick={(event: MouseEvent) => {
                  if (event.button === MIDDLE_BUTTON) {
                    event.preventDefault();
                    openPlugin(plugin, dispositionFor(event, true));
                  }
                }}
              >
                {plugin.name}
              </Menu.Item>
            ))}
            <div className={styles.Footer} aria-hidden='true'>
              <span data-active={dispositionFor(held) === 'tab' || undefined}><Hotkey size='sm' keys={['Enter']} /> Tab</span>
              <span data-active={dispositionFor(held) === 'background' || undefined}><Hotkey size='sm' keys={[MOD, 'Enter']} /> Background</span>
              <span data-active={dispositionFor(held) === 'window' || undefined}><Hotkey size='sm' keys={['Shift', 'Enter']} /> Window</span>
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
