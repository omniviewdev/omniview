import { useEffect, useRef } from 'react';

// xterm
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from 'xterm-addon-canvas';
import { WebglAddon } from 'xterm-addon-webgl';
import { debounce } from '@/utils/debounce';

// project import
import { AttachSession, DetachSession, ResizeSession, WriteSession } from '@api/exec/Client';
import { bottomDrawerChannel } from '../events';
import * as runtime from '@runtime/runtime.js';
import { Base64 } from 'js-base64';

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
  [ 'CLOSE', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGUSR1', 'SIGUSR2', 'SIGWINCH' ].forEach((signal) => {
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
  const terminalRef = useRef<HTMLDivElement>(null);

  const disposers = useRef<Array<() => void>>([]);
  const xtermRef = useRef<Terminal | undefined>(undefined);

  const fitAddonRef = useRef<FitAddon | undefined>(undefined);
  const canvasAddonRef = useRef<CanvasAddon | undefined>(undefined);
  const webglAddonRef = useRef<WebglAddon | undefined>(undefined);

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
      cursorBlink: true,
      allowProposedApi: true,
      allowTransparency: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      scrollback: 0,
      fontSize: 13,
      fontFamily: 'Hack,Consolas,Liberation Mono,Menlo,Courier,monospace',
      fontWeight: 'normal',
    });

    xtermRef.current = terminal;

    const fitAddon = new FitAddon();
    const canvasAddon = new CanvasAddon();
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(e => {
      console.log('context loss', e);
      webglAddon.dispose();
    });

    terminal.open(terminalRef.current);

    fitAddonRef.current = fitAddon;
    canvasAddonRef.current = canvasAddon;
    webglAddonRef.current = webglAddon;

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(canvasAddon);
    terminal.loadAddon(webglAddon);

    terminal.focus();

    const debouncedFit = debounce(() => {
      fitAddon.fit();
    }, 40);

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
      ResizeSession(sessionId, rows, cols).catch((err) => {
        console.error('failed to set tty size', err);
      });
    });

    const stdout = `core/exec/stream/stdout/${sessionId}`;
    const stderr = `core/exec/stream/stderr/${sessionId}`;

    // Function to handle attachment logic
    const attachToSession = async () => {
      console.log('attaching to session', sessionId);

      try {
        const data = await AttachSession(sessionId);
        console.log('attach data', data.buffer);

        if (data.buffer !== null && data.buffer !== undefined) {
          terminal.write(Base64.toUint8Array(data.buffer as unknown as string));
        }
      } catch (e) {
        console.error('failed to attach to session', e);
      }

      runtime.EventsOn(stdout, (data: number[]) => {
        if (data !== null && data !== undefined) {
          terminal.write(Base64.toUint8Array(data as unknown as string));
        }
      });

      runtime.EventsOn(stderr, (data: number[]) => {
        if (data !== null && data !== undefined) {
          terminal.write(Base64.toUint8Array(data as unknown as string));
        }
      });

      setupSignalHandlers(sessionId);
    };

    attachToSession().then(() => {
      console.log('attached to session %s', sessionId);

      terminal.onData(data => {
        WriteSession(sessionId, data)
          .catch((err) => {
            if (err instanceof Error) {
              console.error('failed to write to session: ', err.message);
              return;
            }
          });
      });

    }).catch((err) => {
      console.error('failed to attach to session', err);
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

      DetachSession(sessionId).then(() => {
        console.log('detached from session %s', sessionId);
      }).catch((err) => {
        if (err instanceof Error) {
          console.error('failed to detach from session: ', err.message);
          return;
        }
      });
    };
  }, [sessionId]);

  return <div 
    ref={terminalRef} 
    style={{ 
      backgroundColor: 'black',
      // a bit hacky, but works
      height: 'calc(100% - 28px)',
      paddingBottom: '34px',
      // paddingLeft: '10px',
    }} 
  />;
}

TerminalContainer.displayName = 'TerminalContainer';
TerminalContainer.whyDidYouRender = true;
