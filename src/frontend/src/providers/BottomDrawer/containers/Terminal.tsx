import { useEffect, useRef } from 'react';

// xterm
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
// import { CanvasAddon } from '@xterm/addon-canvas';
// import { WebglAddon } from '@xterm/addon-webgl';
// import { WebLinksAddon } from '@xterm/addon-web-links';
import { debounce } from '@/utils/debounce';

// project import
import { AttachToSession, DetachFromSession, SetTTYSize, WriteToSession } from '@api/terminal/TerminalManager';
import * as runtime from '@runtime/runtime.js';
import { Base64 } from 'js-base64';

type Props = {
  /** The session ID */
  sessionId: string;
};

/**
* Terminal view attaches to an existing terminal session and displays the output, as well as
* allows the user to input commands. This component is used in the terminal tab of the lower
* context area.
*/
export default function TerminalContainer({ sessionId }: Props) {
  const terminalRef = useRef<HTMLDivElement>(null); // For the terminal container div
  const disposers = useRef<Array<() => void>>([]); // For keepin track of things we need to do when killing the terminal session
  const xtermRef = useRef<Terminal | undefined>(undefined);
  const fitAddonRef = useRef<FitAddon | undefined>(undefined);

  // const { height } = useBottomDrawer();
  
  useEffect(() => {
    if (xtermRef.current === null || fitAddonRef.current === undefined) {
      return;
    }

    console.log('fitting terminal');

    fitAddonRef.current.fit();
  }, []);

  console.log('rerender');

  useEffect(() => {
    // Don't attempt if the ref is not set
    if (terminalRef.current === null) {
      return;
    }

    if (sessionId === '') {
      return;
    }

    // Initialize Terminal
    const xterm = new Terminal({
      cursorBlink: true,
      allowProposedApi: true,
      allowTransparency: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      scrollback: 0,
      fontSize: 13,
      fontFamily: 'Consolas,Liberation Mono,Menlo,Courier,monospace',
    });

    xtermRef.current = xterm;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    disposers.current.push(() => {
      fitAddon.dispose();
    });

    // Const canvasAddon = new CanvasAddon();
    // disposers.current.push(() => canvasAddon.dispose());

    xterm.open(terminalRef.current);

    xterm.loadAddon(fitAddon);
    // Xterm.loadAddon(canvasAddon);

    // xterm.focus();

    // terminal.focus();
    fitAddon.fit();

    const debouncedFit = debounce(() => {
      console.log('fitting terminal');
      fitAddon.fit();
    }, 100);

    const resizeObserver = new ResizeObserver((_val) => {
      debouncedFit();
    });

    // resizeObserver.observe(terminalRef.current);

    // perform initial fit
    // fitAddon.fit();


    // clear the data in the terminal
    if (xtermRef.current === undefined) {
      return;
    }

    const eventkey = `core/terminal/${sessionId}`;
    // xtermRef.current.clear();

    // Function to handle attachment logic
    const attachToSession = async () => {
      if (xtermRef.current === undefined) {
        return;
      }

      console.log('attaching to session', sessionId);

      try {
        // Assuming attach method returns previous lines and subscribes to new output
        // AttachToSession returns a byte array, so we need to convert it to a string
        const data = await AttachToSession(sessionId) as unknown as string;
        if (data !== null && data !== undefined) {
          xtermRef.current?.write(Base64.toUint8Array(data));
        }
      } catch (e) {
        console.error('failed to attach to session', e);
      }

      // Listen for terminal data from the backend
      runtime.EventsOn(eventkey, (data: string) => {
        console.log('received data from backend', data);
        if (data !== null && data !== undefined) {
          xtermRef.current?.write(Base64.toUint8Array(data));
        }
      });
    };

    const debouncedResize = debounce((rows: number, cols: number) => {
      SetTTYSize(sessionId, rows, cols).catch((err) => {
        console.error('failed to set tty size', err);
      });
    }, 1000);

    // Attach to the session
    attachToSession().then(() => {
      console.log('attached to session');

      xtermRef.current?.onResize((size) => {
        debouncedResize(size.rows, size.cols);
      });

      xtermRef.current?.onData(data => {
        WriteToSession(sessionId, data)
          .then(() => {
            console.log('Data sent');
          })
          .catch(() => {
            console.error('failed to send data');
          });
      });

    }).catch((err) => {
      console.error('failed to attach to session', err);
    });


    // Cleanup function to detach from the session and remove listeners
    return () => {
      xterm.clear();
      xterm.dispose();

      if (terminalRef.current !== null) {
        resizeObserver.unobserve(terminalRef.current);
      }

      runtime.EventsOff(eventkey);

      // Run our disposers
      disposers.current.forEach(disposer => {
        disposer();
      });

      DetachFromSession(sessionId).then(() => {
        console.log('detached from session');
      }).catch((err) => {
        console.error('failed to detach from session', err);
      });
    };
  }, [sessionId]);

  return <div 
    ref={terminalRef} 
    style={{ 
      backgroundColor: 'black',
      paddingLeft: '10px',
      height: 'calc(100% - 40px)',
      maxWidth: '100%',
      display: 'flex',
      flex: 1,
      minHeight: 0,
      minWidth: 0,
      overflow: 'hidden',
    }} 
  />;
}

TerminalContainer.displayName = 'TerminalContainer';
TerminalContainer.whyDidYouRender = true;
