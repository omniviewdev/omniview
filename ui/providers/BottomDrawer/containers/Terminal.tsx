import { useEffect, useRef } from 'react';

// xterm
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebglAddon } from '@xterm/addon-webgl';
import { debounce } from '@/utils/debounce';

// project import
import { ExecClient } from '@omniviewdev/runtime/api';
import log from '@/features/logger';
import { bottomDrawerChannel } from '../events';
import * as runtime from '@omniviewdev/runtime/runtime';
import { Base64 } from 'js-base64';
import { useSettings } from '@omniviewdev/runtime';

type Props = {
  /** The session ID */
  sessionId: string;
};

const constructSignalHandler = (signal: string, sessionId: string) => {
  return `core/exec/signal/${signal}/${sessionId}`;
};

const setupSignalHandlers = (sessionId: string) => {
  runtime.EventsOn(constructSignalHandler('CLOSE', sessionId), () => {
    console.log('session closed');
    bottomDrawerChannel.emit('onSessionClosed', { id: sessionId });
  });

  // TODO: Implementing these for now just to visualize and prepare, but not actually handling them
  // Will determine if we even need these.

  runtime.EventsOn(constructSignalHandler('SIGINT', sessionId), () => {
    console.log('SIGINT');
  });
  runtime.EventsOn(constructSignalHandler('SIGQUIT', sessionId), () => {
    console.log('SIGQUIT');
  });
  runtime.EventsOn(constructSignalHandler('SIGTERM', sessionId), () => {
    console.log('SIGTERM');
  });
  runtime.EventsOn(constructSignalHandler('SIGKILL', sessionId), () => {
    console.log('SIGKILL');
  });
  runtime.EventsOn(constructSignalHandler('SIGHUP', sessionId), () => {
    console.log('SIGHUP');
  });
  runtime.EventsOn(constructSignalHandler('SIGUSR1', sessionId), () => {
    console.log('SIGUSR1');
  });
  runtime.EventsOn(constructSignalHandler('SIGUSR2', sessionId), () => {
    console.log('SIGUSR2');
  });
  runtime.EventsOn(constructSignalHandler('SIGWINCH', sessionId), () => {
    console.log('SIGWINCH');
  });
};

const cleanupSignalHandlers = (sessionId: string) => {
  ['CLOSE', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGUSR1', 'SIGUSR2', 'SIGWINCH'].forEach((signal) => {
    runtime.EventsOff(constructSignalHandler(signal, sessionId));
  });
};

/**
 *
* Terminal view attaches to an existing terminal session and displays the output, as well as
* allows the user to input commands. This component is used in the terminal tab of the lower
* context area.
*/
export default function TerminalContainer({ sessionId }: Props) {
  const { settings } = useSettings();

  const terminalRef = useRef<HTMLDivElement>(null);

  const disposers = useRef<Array<() => void>>([]);
  const xtermRef = useRef<Terminal | undefined>(undefined);

  const fitAddonRef = useRef<FitAddon | undefined>(undefined);
  // const canvasAddonRef = useRef<CanvasAddon | undefined>(undefined);
  // const webglAddonRef = useRef<WebglAddon | undefined>(undefined);

  const textDecoder = new TextDecoder();

  const handleFit = () => {
    if (fitAddonRef.current !== undefined) {
      fitAddonRef.current.fit();
    }
  };

  useEffect(() => {
    // Don't attempt if the ref is not set
    if (terminalRef.current === null) {
      return;
    }

    if (sessionId === '') {
      return;
    }

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
    terminal.loadAddon(new CanvasAddon());
    terminal.loadAddon(new WebglAddon());

    terminal.focus();

    const debouncedFit = debounce(() => {
      fitAddon.fit();
    }, 10);

    window.onresize = () => {
      handleFit();
    };

    const resizeObserver = new ResizeObserver((_val) => {
      debouncedFit();
    });

    resizeObserver.observe(terminalRef.current);

    terminal.onResize((event) => {
      var rows = event.rows;
      var cols = event.cols;
      ExecClient.ResizeSession(sessionId, rows, cols).catch((err) => {
        log.error(err instanceof Error ? err : new Error(String(err)), { event: 'resize_session', sessionId });
      });
    });

    const stdout = `core/exec/stream/stdout/${sessionId}`;
    const stderr = `core/exec/stream/stderr/${sessionId}`;

    // Function to handle attachment logic
    const attachToSession = async () => {
      runtime.EventsOn(stdout, (data: any) => {
        if (data !== null && data !== undefined) {
          terminal.write(textDecoder.decode(Base64.toUint8Array(data)));
        }
      });

      runtime.EventsOn(stderr, (data: any) => {
        if (data !== null && data !== undefined) {
          terminal.write(textDecoder.decode(Base64.toUint8Array(data)));
        }
      });

      try {
        await ExecClient.AttachSession(sessionId);
      } catch (e) {
        log.error(e instanceof Error ? e : new Error(String(e)), { event: 'attach_session', sessionId });
      }

      setupSignalHandlers(sessionId);
    };

    attachToSession().then(() => {
      fitAddon.fit()
      terminal.onData(data => {
        ExecClient.WriteSession(sessionId, data)
          .catch((err) => {
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

      try {
        terminal.dispose();
      } catch (e) {
        console.log(e);
      }

      if (terminalRef.current !== null) {
        resizeObserver.unobserve(terminalRef.current);
      }

      // cleanup signal handlers
      cleanupSignalHandlers(sessionId);
      ExecClient.DetachSession(sessionId).then(() => {
      }).catch((err) => {
        if (err instanceof Error) {
          log.error(err, { event: 'detach_session', sessionId });
          return;
        }
      });
    };
  }, [sessionId, settings]);

  return <div
    ref={terminalRef}
    style={{
      backgroundColor: 'black',
      // a bit hacky, but works
      height: 'calc(100% - 28px)',
      paddingBottom: '34px',
    }}
  />;
}

TerminalContainer.displayName = 'TerminalContainer';
TerminalContainer.whyDidYouRender = true;
