import { useEffect, useRef, useState, useCallback } from 'react';

// material-ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

// xterm
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { debounce } from '@/utils/debounce';

// project import
import { ExecClient } from '@omniviewdev/runtime/api';
import { exec } from '@omniviewdev/runtime/models';
import log from '@/features/logger';
import { bottomDrawerChannel } from '../events';
import * as runtime from '@omniviewdev/runtime/runtime';
import { Base64 } from 'js-base64';
import { useSettings } from '@omniviewdev/runtime';
import type { BottomDrawerTab } from '@omniviewdev/runtime';
import TerminalError, { type TerminalErrorInfo } from './TerminalError';

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

  const tabStatus = tab?.properties?.status as string | undefined;

  // Show loading state while session is being created
  if (tabStatus === 'connecting') {
    return (
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        bgcolor: 'black',
        gap: 1.5,
      }}>
        <CircularProgress size={24} sx={{ color: 'grey.500' }} />
        <Box sx={{ color: 'grey.500', fontSize: 13, fontFamily: 'monospace' }}>
          Connecting...
        </Box>
      </Box>
    );
  }

  // Show error state if session creation failed
  if (tabStatus === 'error') {
    const errorMsg = tab?.properties?.error as string | undefined;
    return (
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        bgcolor: 'black',
        gap: 1,
      }}>
        <Box sx={{ color: 'error.main', fontSize: 14, fontFamily: 'monospace', fontWeight: 600 }}>
          Connection Failed
        </Box>
        {errorMsg && (
          <Box sx={{ color: 'grey.500', fontSize: 12, fontFamily: 'monospace', maxWidth: 500, textAlign: 'center', px: 2 }}>
            {errorMsg}
          </Box>
        )}
      </Box>
    );
  }

  const terminalRef = useRef<HTMLDivElement>(null);

  const disposers = useRef<Array<() => void>>([]);
  const xtermRef = useRef<Terminal | undefined>(undefined);

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
    const opts = exec.SessionOptions.createFrom({
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

  useEffect(() => {
    // Don't attempt if the ref is not set
    if (terminalRef.current === null) {
      return;
    }

    if (sessionId === '') {
      return;
    }

    // Reset error state on new session
    setError(null);
    errorRef.current = null;

    // Initialize Terminal
    const terminal = new Terminal({
      cursorBlink: settings['terminal.cursorBlink'],
      cursorStyle: settings['terminal.cursorStyle'],
      allowProposedApi: true,
      allowTransparency: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      fontSize: settings['terminal.fontSize'] || 12,
      fontFamily: "Consolas,Liberation Mono,Menlo,Courier,monospace",
      fontWeight: 'normal',
    });

    xtermRef.current = terminal;

    const fitAddon = new FitAddon();

    terminal.open(terminalRef.current);

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
        log.error(err instanceof Error ? err : new Error(String(err)), { event: 'resize_session', sessionId });
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
      runtime.EventsOn(constructSignalHandler('ERROR', sessionId), (errorInfo: any) => {
        if (errorInfo && typeof errorInfo === 'object') {
          const info: TerminalErrorInfo = {
            title: errorInfo.title || errorInfo.Title || 'Session error',
            suggestion: errorInfo.suggestion || errorInfo.Suggestion || 'The session encountered an error.',
            raw: errorInfo.message || errorInfo.Message || '',
            retryable: errorInfo.retryable ?? errorInfo.Retryable ?? false,
            retryCommands: errorInfo.retry_commands || errorInfo.RetryCommands || errorInfo.retry_Commands,
          };
          errorRef.current = info;
          setError(info);
        }
      });

      // CLOSE signal: session is done
      runtime.EventsOn(constructSignalHandler('CLOSE', sessionId), () => {
        // If an error overlay is already showing, don't auto-close the tab
        if (errorRef.current) {
          return;
        }
        // Only auto-close the tab if the session was successfully attached
        if (attachedRef.current) {
          bottomDrawerChannel.emit('onSessionClosed', { id: sessionId });
        }
      });

      runtime.EventsOn(constructSignalHandler('SIGINT', sessionId), () => { console.log('SIGINT'); });
      runtime.EventsOn(constructSignalHandler('SIGQUIT', sessionId), () => { console.log('SIGQUIT'); });
      runtime.EventsOn(constructSignalHandler('SIGTERM', sessionId), () => { console.log('SIGTERM'); });
      runtime.EventsOn(constructSignalHandler('SIGKILL', sessionId), () => { console.log('SIGKILL'); });
      runtime.EventsOn(constructSignalHandler('SIGHUP', sessionId), () => { console.log('SIGHUP'); });
      runtime.EventsOn(constructSignalHandler('SIGUSR1', sessionId), () => { console.log('SIGUSR1'); });
      runtime.EventsOn(constructSignalHandler('SIGUSR2', sessionId), () => { console.log('SIGUSR2'); });
      runtime.EventsOn(constructSignalHandler('SIGWINCH', sessionId), () => { console.log('SIGWINCH'); });
    };

    setupSignalHandlers();

    // Function to handle attachment logic
    const attachToSession = async () => {
      runtime.EventsOn(stdout, (data: any) => {
        if (data !== null && data !== undefined) {
          const decoded = textDecoder.decode(Base64.toUint8Array(data));
          terminal.write(decoded);
        }
      });

      runtime.EventsOn(stderr, (data: any) => {
        if (data !== null && data !== undefined) {
          const decoded = textDecoder.decode(Base64.toUint8Array(data));
          terminal.write(decoded);
        }
      });

      try {
        await ExecClient.AttachSession(sessionId);
      } catch (e) {
        log.error(e instanceof Error ? e : new Error(String(e)), { event: 'attach_session', sessionId });
      }
    };

    attachToSession().then(() => {
      attachedRef.current = true;
      fitAddon.fit()
      terminal.onData(data => {
        ExecClient.WriteSession(sessionId, data)
          .catch((err: unknown) => {
            if (err instanceof Error) {
              log.error(err, { event: 'write_session', sessionId });
              return;
            }
          });
      });

    }).catch((err) => {
      log.error(err instanceof Error ? err : new Error(String(err)), { event: 'attach_session', sessionId });
    });


    // Cleanup function to detach from the session and remove listeners
    return () => {
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

      if (terminalRef.current !== null) {
        resizeObserver.unobserve(terminalRef.current);
      }

      // cleanup signal handlers
      ['ERROR', 'CLOSE', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGUSR1', 'SIGUSR2', 'SIGWINCH'].forEach((signal) => {
        runtime.EventsOff(constructSignalHandler(signal, sessionId));
      });
      ExecClient.DetachSession(sessionId).then(() => {
      }).catch((err: unknown) => {
        if (err instanceof Error) {
          log.error(err, { event: 'detach_session', sessionId });
          return;
        }
      });
    };
  }, [sessionId, settings]);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div
        ref={terminalRef}
        style={{
          backgroundColor: 'black',
          height: '100%',
          width: '100%',
        }}
      />
      {error && <TerminalError error={error} onRetry={handleRetry} />}
    </div>
  );
}

TerminalContainer.displayName = 'TerminalContainer';
