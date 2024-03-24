import { type FC, useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
// Import { CanvasAddon } from "xterm-addon-canvas";
import { AttachToSession, DetachFromSession, WriteToSession } from '@api/services/TerminalManager';
import * as runtime from '@runtime/runtime.js';
import { Base64 } from 'js-base64';

type Props = {
  /** The session ID */
  sessionId: string;
  /** The height of the terminal */
  height: number;
};

/**
* Terminal view attaches to an existing terminal session and displays the output, as well as
* allows the user to input commands. This component is used in the terminal tab of the lower
* context area.
*/
const TerminalView: FC<Props> = ({ sessionId, height }) => {
  const terminalRef = useRef<HTMLDivElement>(null); // For the terminal container div
  const disposers = useRef<Array<() => void>>([]); // For keepin track of things we need to do when killing the terminal session

  const eventKey = `terminal::${sessionId}`;
  console.log('rerender');

  useEffect(() => {
    // Don't attempt if the ref is not set
    if (terminalRef.current === null) {
      return;
    }

    // Initialize Terminal
    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, \'Liberation Mono\', Menlo, Courier, monospace',
    });

    const fitAddon = new FitAddon();
    disposers.current.push(() => {
      fitAddon.dispose();
    });

    // Const canvasAddon = new CanvasAddon();
    // disposers.current.push(() => canvasAddon.dispose());

    xterm.open(terminalRef.current);

    xterm.loadAddon(fitAddon);
    // Xterm.loadAddon(canvasAddon);

    xterm.focus();

    // Fit the terminal to the container
    terminalRef.current.onresize = () => {
      fitAddon.fit();
    };

    // Function to handle attachment logic
    const attachToSession = async () => {
      console.log('attaching to session', sessionId);

      try {
        // Assuming attach method returns previous lines and subscribes to new output
        // AttachToSession returns a byte array, so we need to convert it to a string
        const data = await AttachToSession(sessionId) as unknown as string;
        if (data !== null && data !== undefined) {
          xterm.write(Base64.toUint8Array(data));
        }
      } catch (e) {
        console.error('failed to attach to session', e);
      }

      // Listen for terminal data from the backend
      runtime.EventsOn(eventKey, (data: string) => {
        console.log('received data from backend', data);
        if (data !== null && data !== undefined) {
          xterm.write(Base64.toUint8Array(data));
        }
      });
    };

    // Attach to the session
    attachToSession();

    xterm.onData(data => {
      WriteToSession(sessionId, data)
        .then(() => {
          console.log('Data sent');
        })
        .catch(() => {
          console.error('failed to send data');
        });
    });

    fitAddon.fit();

    // Cleanup function to detach from the session and remove listeners
    return () => {
      console.log('detaching from session', sessionId);
      // Run our disposers
      disposers.current.forEach(disposer => {
        disposer();
      });

      DetachFromSession(sessionId).then(() => {
        runtime.EventsOff(eventKey);
        try {
          xterm.dispose();
        } catch (e) {
          console.error('failed to dispose xterm', e);
        }
      });
    };
  }, [sessionId]); // Re-run effect if sessionId changes, since we need to attach to a new session

  return <div ref={terminalRef} style={{ height, width: '100%', overflow: 'hidden' }} />;
};

export default TerminalView;
