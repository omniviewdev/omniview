import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';

// ui
import { Spinner, useTheme } from '@omniviewdev/base-ui';
import styles from './Terminal.module.css';

// xterm
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
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

function recoveryFor(properties: Record<string, unknown> | undefined, error: TerminalErrorInfo) {
  const recovery = properties?.recovery;
  if (!recovery || typeof recovery !== 'object'
    || !('label' in recovery) || typeof recovery.label !== 'string'
    || !('canRecover' in recovery) || typeof recovery.canRecover !== 'function'
    || !('run' in recovery) || typeof recovery.run !== 'function') {
    return undefined;
  }

  const { label, canRecover, run } = recovery;
  try {
    if (canRecover(error)) {
      return { label, run: async () => {
        await run(); 
      } };
    }
  } catch {
    // An unavailable plugin recovery must not replace the original terminal error.
  }

  return undefined;
}

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

  // Error state (set by structured ERROR signal from plugin)
  const errorRef = useRef<TerminalErrorInfo | null>(null);
  const [error, setError] = useState<TerminalErrorInfo | null>(null);
  const [errorContext, setErrorContext] = useState({ sessionId, tabStatus, themeElement });
  if (errorContext.sessionId !== sessionId || errorContext.tabStatus !== tabStatus || errorContext.themeElement !== themeElement) {
    setErrorContext({ sessionId, tabStatus, themeElement });
    setError(null);
  }

  const [textDecoder] = useState(() => new TextDecoder());

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
      replaceSessionId: sessionId,
    });
  }, [tab, sessionId]);

  // Keep a ref to the latest settings so the session-lifecycle effect can
  // read current values without re-running when settings change.
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!themeElement) {
      return;
    }

    const background = getTerminalTheme(themeName, themeElement).background ?? '';
    themeElement.style.setProperty('--terminal-background', background);
    themeElement.parentElement?.style.setProperty('--terminal-background', background);
  }, [activeTheme, themeName, themeElement]);

  // Apply settings and the post-commit theme to a live terminal without
  // recreating it.
  useEffect(() => {
    const term = xtermRef.current;
    if (!term || themeElement === null) {
      return;
    }

    term.options.theme = getTerminalTheme(themeName, themeElement);
    term.options.cursorBlink = settings['terminal.cursorBlink'] as boolean;
    term.options.cursorStyle = settings['terminal.cursorStyle'] as 'block' | 'underline' | 'bar';
    term.options.fontSize = (settings['terminal.fontSize'] as number) || 12;
  }, [activeTheme, themeName, themeElement, settings]);

  // Own teardown separately from initialization so a post-commit theme
  // resolution can initialize or update xterm without recreating it.
  useEffect(() => {
    return () => {
      terminalCleanupRef.current?.();
      terminalCleanupRef.current = null;
    };
  }, [themeElement, sessionId, tabStatus]);

  useEffect(() => {
    if (
      tabStatus === 'connecting'
      || tabStatus === 'error'
      || terminalRef.current === null
      || themeElement === null
      || xtermRef.current !== undefined
      || sessionId === ''
    ) {
      return;
    }

    // Reset error state on new session
    errorRef.current = null;

    const s = settingsRef.current;
    const theme = getTerminalTheme(themeName, terminalRef.current);
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

    let webglAddon: WebglAddon | undefined;
    try {
      webglAddon = new WebglAddon();
      const renderer = webglAddon;
      renderer.onContextLoss(() => {
        // Disposing WebGL restores xterm's built-in DOM renderer.
        renderer.dispose();
      });
      terminal.loadAddon(renderer);
    } catch (error) {
      webglAddon?.dispose();
      // WebGL is optional; the built-in DOM renderer keeps the session usable.
      log.error(new Error(parseAppError(error).detail), { event: 'terminal_webgl' });
    }

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

    const resizeSession = (rows: number, cols: number) => {
      ExecClient.ResizeSession(sessionId, rows, cols).catch((err: unknown) => {
        log.error(new Error(parseAppError(err).detail), { event: 'resize_session', sessionId });
      });
    };

    terminal.onResize(({ rows, cols }) => {
      if (attachedRef.current && inputActive) {
        resizeSession(rows, cols);
      }
    });

    const stdout = `core/exec/stream/stdout/${sessionId}`;
    const stderr = `core/exec/stream/stderr/${sessionId}`;

    // Track whether the session has been attached so we can distinguish
    // fast failures (CLOSE before/during attach) from normal session endings.
    const attachedRef = { current: false };
    let inputActive = true;
    let inputWrites = Promise.resolve();
    const failTerminalIO = (cause: unknown, operation: 'attach' | 'write') => {
      if (!inputActive) {
        return;
      }

      inputActive = false;
      const appError = parseAppError(cause);
      const info: TerminalErrorInfo = {
        title: operation === 'attach' ? 'Terminal attachment failed' : 'Terminal input failed',
        suggestion: operation === 'attach'
          ? 'Reconnect to the existing session before sending input.'
          : 'Input delivery is uncertain. Reconnect before sending more input; do not automatically resend it.',
        raw: appError.detail,
        retryable: false,
      };
      if (!errorRef.current) {
        errorRef.current = info;
        setError(info);
      }

      log.error(new Error(appError.detail), { event: `${operation}_session`, sessionId });
    };

    // Setup signal handlers.
    // Registered BEFORE attach so we don't miss fast signals on sessions
    // that fail immediately (e.g., ERROR followed by CLOSE).
    const setupSignalHandlers = () => {
      // ERROR signal: structured error from plugin layer
      Events.On(constructSignalHandler('ERROR', sessionId), (ev) => {
        const errorInfo = ev.data;
        if (errorInfo && typeof errorInfo === 'object') {
          inputActive = false;
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
        inputActive = false;
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

        return true;
      } catch (e) {
        failTerminalIO(e, 'attach');
        return false;
      }
    };

    attachToSession().then((attached) => {
      if (!attached || !inputActive) {
        return;
      }

      fitAddon.fit();
      attachedRef.current = true;
      // A pre-attach fit can consume onResize; always send the current size after attachment.
      resizeSession(terminal.rows, terminal.cols);
      terminal.onData(data => {
        if (!inputActive) {
          return;
        }

        inputWrites = inputWrites.then(async () => {
          if (inputActive) {
            await ExecClient.WriteSession(sessionId, Base64.encode(data));
          }
        }).catch((cause: unknown) => {
          failTerminalIO(cause, 'write'); 
        });
      });

    }).catch((err: unknown) => {
      log.error(new Error(parseAppError(err).detail), { event: 'attach_session', sessionId });
    });


    // Cleanup function to detach from the session and remove listeners
    terminalCleanupRef.current = () => {
      inputActive = false;
      // run our disposers
      disposers.current.forEach((disposer) => {
        disposer();
      });

      window.removeEventListener('resize', handleWindowResize);
      unsubscribeResizeReset();

      try {
        terminal.dispose();
      } catch (e) {
        console.log(e);
      }

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
  }, [themeElement, themeName, activeTheme, sessionId, tabStatus, textDecoder]);

  const bgColor = 'var(--terminal-background)';

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
    const initialError = tab?.properties?.errorInfo as TerminalErrorInfo | undefined;
    const recovery = initialError ? recoveryFor(tab?.properties, initialError) : undefined;
    if (initialError && recovery) {
      return (
        <div ref={statusThemeRef} className={styles.Status} style={{ backgroundColor: bgColor }}>
          <TerminalError error={initialError} onRetry={handleRetry} backgroundColor={bgColor} recovery={recovery} />
        </div>
      );
    }

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
      {error && <TerminalError error={error} onRetry={handleRetry} backgroundColor={bgColor} recovery={recoveryFor(tab?.properties, error)} />}
    </div>
  );
}

TerminalContainer.displayName = 'TerminalContainer';
