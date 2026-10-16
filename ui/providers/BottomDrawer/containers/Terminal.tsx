import { useEffect, useRef, useState, useCallback } from 'react';

// ui
import { Spinner, useTheme, type ThemeSummary } from '@omniviewdev/base-ui';
import styles from './Terminal.module.css';

// xterm
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { debounce } from '@/utils/debounce';
import { orFallback } from '@/utils/orFallback';

// project import
import { ExecClient } from '@omniviewdev/runtime/api';
import { SessionOptions } from '@omniviewdev/runtime/models';
import log from '@/features/logger';
import { bottomDrawerChannel } from '../events';
import { Events } from '@omniviewdev/runtime/runtime';
import { Base64 } from 'js-base64';
import { useSettings, parseAppError } from '@omniviewdev/runtime';
import type { BottomDrawerTab } from '@omniviewdev/runtime';
import TerminalError, { type TerminalErrorInfo } from './TerminalError';
import { getTerminalTheme } from './terminalThemes';

type Props = {
  /** The session ID */
  sessionId: string;
  /** The full tab object (used for retry metadata) */
  tab?: BottomDrawerTab;
};

const constructSignalHandler = (signal: string, sessionId: string) => {
  return `core/exec/signal/${signal}/${sessionId}`;
};

/**
 * Terminal view attaches to an existing terminal session and displays the output, as well as
 * allows the user to input commands. This component is used in the terminal tab of the lower
 * context area.
 */
export default function TerminalContainer({ sessionId, tab }: Props) {
  const { settings } = useSettings();
  const { activeTheme } = useTheme();

  const tabStatus = tab?.properties?.status as string | undefined;
  const themeName = (settings['terminal.theme'] as string) || 'application';

  const terminalRef = useRef<HTMLDivElement>(null);
  const [themeElement, setThemeElement] = useState<HTMLDivElement | null>(null);
  const [themeResolution, setThemeResolution] = useState<{
    activeTheme: Readonly<ThemeSummary>;
    element: HTMLDivElement;
    name: string;
    theme: ITheme;
  } | null>(null);
  const resolvedThemeRef = useRef<ITheme | null>(null);

  const statusThemeRef = useCallback((element: HTMLDivElement | null) => {
    setThemeElement(element);
  }, []);

  const terminalThemeRef = useCallback((element: HTMLDivElement | null) => {
    terminalRef.current = element;
    setThemeElement(element);
  }, []);

  const disposers = useRef<Array<() => void>>([]);
  const xtermRef = useRef<Terminal | undefined>(undefined);
  const terminalCleanupRef = useRef<(() => void) | null>(null);

  const fitAddonRef = useRef<FitAddon | undefined>(undefined);
  const canvasAddonRef = useRef<CanvasAddon | undefined>(undefined);
  const webglAddonRef = useRef<WebglAddon | undefined>(undefined);

  // Error state (set by structured ERROR signal from plugin)
  const errorRef = useRef<TerminalErrorInfo | null>(null);
  const [error, setError] = useState<TerminalErrorInfo | null>(null);

  const textDecoder = new TextDecoder();

  const handleFit = () => {
    if (fitAddonRef.current !== undefined) {
      fitAddonRef.current.fit();
    }
  };

  const handleRetry = useCallback((command: string[]) => {
    const props = tab?.properties as Record<string, any> | undefined;
    if (!props?.pluginID || !props?.connectionID) {
      return;
    }

    // Build session opts from stored tab properties, overriding command
    const opts = SessionOptions.createFrom({
      tty: true,
      ...((props.opts ?? {}) as Record<string, unknown>),
      command,
    });

    bottomDrawerChannel.emit('onCreateSession', {
      plugin: props.pluginID as string,
      connection: props.connectionID as string,
      opts,
      label: tab?.title,
    });

    // Close the errored tab
    bottomDrawerChannel.emit('onSessionClosed', { id: sessionId });
  }, [tab, sessionId]);

  // Keep a ref to the latest settings so the session-lifecycle effect can
  // read current values without re-running when settings change.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // CSS variables are committed by ThemeProvider after render. Resolve from
  // the mounted element in a passive effect so scoped tokens are current.
  useEffect(() => {
    if (themeElement === null) {
      return;
    }

    setThemeResolution({
      activeTheme,
      element: themeElement,
      name: themeName,
      theme: getTerminalTheme(themeName, themeElement),
    });
  }, [activeTheme, themeElement, themeName]);

  const resolvedTheme = themeResolution?.activeTheme === activeTheme
    && themeResolution.element === themeElement
    && themeResolution.name === themeName
    ? themeResolution.theme
    : null;
  const resolvedElement = themeResolution?.element === themeElement
    ? themeElement
    : null;
  resolvedThemeRef.current = resolvedTheme;

  // Apply settings and the post-commit theme to a live terminal without
  // recreating it.
  useEffect(() => {
    const term = xtermRef.current;
    if (!term || resolvedTheme === null) {
      return;
    }

    term.options.theme = resolvedTheme;
    term.options.cursorBlink = settings['terminal.cursorBlink'] as boolean;
    term.options.cursorStyle = settings['terminal.cursorStyle'] as 'block' | 'underline' | 'bar';
    term.options.fontSize = (settings['terminal.fontSize'] as number) || 12;
  }, [resolvedTheme, settings]);

  // Own teardown separately from initialization so a post-commit theme
  // resolution can initialize or update xterm without recreating it.
  useEffect(() => {
    return () => {
      terminalCleanupRef.current?.();
      terminalCleanupRef.current = null;
    };
  }, [resolvedElement, sessionId, tabStatus]);

  useEffect(() => {
    if (
      tabStatus === 'connecting'
      || tabStatus === 'error'
      || terminalRef.current === null
      || resolvedElement === null
      || resolvedThemeRef.current === null
      || xtermRef.current !== undefined
      || sessionId === ''
    ) {
      return;
    }

    // Reset error state on new session
    setError(null);
    errorRef.current = null;

    const s = settingsRef.current;
    const theme = resolvedThemeRef.current;
    const terminalElement = terminalRef.current;
    // Initialize Terminal
    const terminal = new Terminal({
      cursorBlink: s['terminal.cursorBlink'],
      cursorStyle: s['terminal.cursorStyle'],
      allowProposedApi: true,
      allowTransparency: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      fontSize: orFallback(s['terminal.fontSize'], 12),
      fontFamily: 'Consolas,Liberation Mono,Menlo,Courier,monospace',
      fontWeight: 'normal',
      theme,
    });

    xtermRef.current = terminal;

    const fitAddon = new FitAddon();

    terminal.open(terminalElement);

    fitAddonRef.current = fitAddon;

    terminal.loadAddon(fitAddon);

    const canvasAddon = new CanvasAddon();
    canvasAddonRef.current = canvasAddon;
    terminal.loadAddon(canvasAddon);

    const webglAddon = new WebglAddon();
    webglAddonRef.current = webglAddon;
    terminal.loadAddon(webglAddon);

    terminal.loadAddon(new WebLinksAddon());

    terminal.focus();

    const debouncedFit = debounce(() => {
      fitAddon.fit();
    }, 10);

    const handleWindowResize = () => {
      handleFit();
    };

    window.addEventListener('resize', handleWindowResize);

    // Re-fit when the bottom drawer finishes a resize transition
    const unsubscribeResizeReset = bottomDrawerChannel.on('onResizeReset', () => {
      handleFit();
    });

    const resizeObserver = new ResizeObserver((_val) => {
      debouncedFit();
    });

    resizeObserver.observe(terminalRef.current);

    terminal.onResize((event) => {
      const rows = event.rows;
      const cols = event.cols;
      ExecClient.ResizeSession(sessionId, rows, cols).catch((err: unknown) => {
        log.error(new Error(parseAppError(err).detail), { event: 'resize_session', sessionId });
      });
    });

    const stdout = `core/exec/stream/stdout/${sessionId}`;
    const stderr = `core/exec/stream/stderr/${sessionId}`;

    // Track whether the session has been attached so we can distinguish
    // fast failures (CLOSE before/during attach) from normal session endings.
    const attachedRef = { current: false };

    // Setup signal handlers.
    // Registered BEFORE attach so we don't miss fast signals on sessions
    // that fail immediately (e.g., ERROR followed by CLOSE).
    const setupSignalHandlers = () => {
      // ERROR signal: structured error from plugin layer
      Events.On(constructSignalHandler('ERROR', sessionId), (ev) => {
        const errorInfo = ev.data;
        if (errorInfo && typeof errorInfo === 'object') {
          const info: TerminalErrorInfo = {
            title: orFallback(orFallback(errorInfo.title, errorInfo.Title), 'Session error'),
            suggestion: orFallback(orFallback(errorInfo.suggestion, errorInfo.Suggestion), 'The session encountered an error.'),
            raw: orFallback(orFallback(errorInfo.message, errorInfo.Message), ''),
            retryable: errorInfo.retryable ?? errorInfo.Retryable ?? false,
            retryCommands: orFallback(orFallback(errorInfo.retry_commands, errorInfo.RetryCommands), errorInfo.retry_Commands),
          };
          errorRef.current = info;
          setError(info);
        }
      });

      // CLOSE signal: session is done
      Events.On(constructSignalHandler('CLOSE', sessionId), () => {
        // If an error overlay is already showing, don't auto-close the tab
        if (errorRef.current) {
          return;
        }

        // Only auto-close the tab if the session was successfully attached
        if (attachedRef.current) {
          bottomDrawerChannel.emit('onSessionClosed', { id: sessionId });
        }
      });

      Events.On(constructSignalHandler('SIGINT', sessionId), () => {
        console.log('SIGINT'); 
      });
      Events.On(constructSignalHandler('SIGQUIT', sessionId), () => {
        console.log('SIGQUIT'); 
      });
      Events.On(constructSignalHandler('SIGTERM', sessionId), () => {
        console.log('SIGTERM'); 
      });
      Events.On(constructSignalHandler('SIGKILL', sessionId), () => {
        console.log('SIGKILL'); 
      });
      Events.On(constructSignalHandler('SIGHUP', sessionId), () => {
        console.log('SIGHUP'); 
      });
      Events.On(constructSignalHandler('SIGUSR1', sessionId), () => {
        console.log('SIGUSR1'); 
      });
      Events.On(constructSignalHandler('SIGUSR2', sessionId), () => {
        console.log('SIGUSR2'); 
      });
      Events.On(constructSignalHandler('SIGWINCH', sessionId), () => {
        console.log('SIGWINCH'); 
      });
    };

    setupSignalHandlers();

    // Function to handle attachment logic
    const attachToSession = async () => {
      Events.On(stdout, (ev) => {
        const data = ev.data;
        if (data !== null && data !== undefined) {
          const decoded = textDecoder.decode(Base64.toUint8Array(data));
          terminal.write(decoded);
        }
      });

      Events.On(stderr, (ev) => {
        const data = ev.data;
        if (data !== null && data !== undefined) {
          const decoded = textDecoder.decode(Base64.toUint8Array(data));
          terminal.write(decoded);
        }
      });

      try {
        const [, buffer] = await ExecClient.AttachSession(sessionId);
        if (buffer) {
          const decoded = textDecoder.decode(Base64.toUint8Array(buffer));
          terminal.write(decoded);
        }
      } catch (e) {
        log.error(new Error(parseAppError(e).detail), { event: 'attach_session', sessionId });
      }
    };

    attachToSession().then(() => {
      attachedRef.current = true;
      fitAddon.fit();
      terminal.onData(data => {
        ExecClient.WriteSession(sessionId, Base64.encode(data))
          .catch((err: unknown) => {
            log.error(new Error(parseAppError(err).detail), { event: 'write_session', sessionId });
          });
      });

    }).catch((err: unknown) => {
      log.error(new Error(parseAppError(err).detail), { event: 'attach_session', sessionId });
    });


    // Cleanup function to detach from the session and remove listeners
    terminalCleanupRef.current = () => {
      // run our disposers
      disposers.current.forEach((disposer) => {
        disposer();
      });

      window.removeEventListener('resize', handleWindowResize);
      unsubscribeResizeReset();

      try {
        canvasAddonRef.current?.dispose();
        webglAddonRef.current?.dispose();
        terminal.dispose();
      } catch (e) {
        console.log(e);
      }

      canvasAddonRef.current = undefined;
      webglAddonRef.current = undefined;
      xtermRef.current = undefined;

      resizeObserver.unobserve(terminalElement);

      // cleanup signal handlers
      ['ERROR', 'CLOSE', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGUSR1', 'SIGUSR2', 'SIGWINCH'].forEach((signal) => {
        Events.Off(constructSignalHandler(signal, sessionId));
      });
      ExecClient.DetachSession(sessionId).then(() => {
        // Nothing to do once detached.
      }).catch((err: unknown) => {
        log.error(new Error(parseAppError(err).detail), { event: 'detach_session', sessionId });
      });
    };
  }, [resolvedElement, resolvedTheme, sessionId, tabStatus]);

  const bgColor = resolvedTheme?.background;

  if (tabStatus === 'connecting') {
    return (
      <div ref={statusThemeRef} className={styles.Status} style={{ backgroundColor: bgColor }}>
        <Spinner size='md' />
        <div className={styles.StatusText}>Connecting...</div>
      </div>
    );
  }

  if (tabStatus === 'error') {
    const errorMsg = tab?.properties?.error as string | undefined;
    return (
      <div ref={statusThemeRef} className={styles.Status} style={{ backgroundColor: bgColor }}>
        <div className={styles.StatusError}>Connection Failed</div>
        {errorMsg && <div className={styles.StatusDetail}>{errorMsg}</div>}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div
        ref={terminalThemeRef}
        style={{
          backgroundColor: bgColor,
          height: '100%',
          width: '100%',
        }}
      />
      {error && <TerminalError error={error} onRetry={handleRetry} backgroundColor={bgColor} />}
    </div>
  );
}

TerminalContainer.displayName = 'TerminalContainer';
