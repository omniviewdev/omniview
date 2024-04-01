import { useEffect, useRef } from 'react';

// xterm
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
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
  // const fitAddonRef = useRef<FitAddon | undefined>(undefined);

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
    const terminal = new Terminal({
      cursorBlink: true,
      allowProposedApi: true,
      allowTransparency: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      scrollback: 0,
      fontSize: 13,
      fontFamily: '"Fira Code", courier-new, courier, monospace, "Powerline Extra Symbols"',
    });

    xtermRef.current = terminal;

    const fitAddon = new FitAddon();
    // const canvasAddon = new CanvasAddon();

    terminal.open(terminalRef.current);

    // fitAddonRef.current = fitAddon;

    terminal.loadAddon(fitAddon);
    disposers.current.push(() => {
      terminal.dispose();
    });
    // terminal.loadAddon(canvasAddon);
    // disposers.current.push(() => {
    //   terminal.dispose();
    // });

    terminal.focus();

    const debouncedFit = debounce(() => {
      console.log('fitting terminal');
      fitAddon.fit();
    }, 40);

    window.onresize = () => {
      fitAddon.fit();
    };

    const resizeObserver = new ResizeObserver((_val) => {
      debouncedFit();
    });

    resizeObserver.observe(terminalRef.current);

    terminal.onResize((event) => {
      var rows = event.rows;
      var cols = event.cols;
      SetTTYSize(sessionId, rows, cols).catch((err) => {
        console.error('failed to set tty size', err);
      });
    });

    const eventkey = `core/terminal/${sessionId}`;

    // Function to handle attachment logic
    const attachToSession = async () => {
      console.log('attaching to session', sessionId);

      try {
        // Assuming attach method returns previous lines and subscribes to new output
        // AttachToSession returns a byte array, so we need to convert it to a string
        const data = await AttachToSession(sessionId) as unknown as string;
        if (data !== null && data !== undefined) {
          terminal.write(Base64.toUint8Array(data));
        }
      } catch (e) {
        console.error('failed to attach to session', e);
      }

      // Listen for terminal data from the backend
      runtime.EventsOn(eventkey, (data: string) => {
        console.log('received data from backend', data);
        if (data !== null && data !== undefined) {
          terminal.write(Base64.toUint8Array(data));
        }
      });
    };

    // Attach to the session
    attachToSession().then(() => {
      console.log('attached to session');

      terminal.onData(data => {
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
      // run our disposers
      disposers.current.forEach((disposer) => {
        disposer();
      }); 

      terminal.dispose();

      if (terminalRef.current !== null) {
        resizeObserver.unobserve(terminalRef.current);
      }

      runtime.EventsOff(eventkey);

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
      // a bit hacky, but works
      height: 'calc(100% - 28px)',
      paddingBottom: '34px',
      // paddingLeft: '10px',
    }} 
  />;
}

TerminalContainer.displayName = 'TerminalContainer';
TerminalContainer.whyDidYouRender = true;
