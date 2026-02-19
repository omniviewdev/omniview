import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface TerminalHandle {
  write: (data: string) => void;
  clear: () => void;
  focus: () => void;
}

export interface TerminalProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  scrollback?: number;
  sx?: SxProps<Theme>;
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  {
    onData,
    onResize,
    fontSize = 13,
    fontFamily,
    cursorStyle = 'bar',
    cursorBlink = true,
    scrollback = 1000,
    sx,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useImperativeHandle(ref, () => ({
    write: (data: string) => xtermRef.current?.write(data),
    clear: () => xtermRef.current?.clear(),
    focus: () => xtermRef.current?.focus(),
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      fontSize,
      fontFamily: fontFamily ?? 'var(--ov-font-mono)',
      cursorStyle,
      cursorBlink,
      scrollback,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    term.open(containerRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    if (onData) {
      term.onData(onData);
    }

    if (onResize) {
      term.onResize(({ cols, rows }) => onResize(cols, rows));
    }

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // container might not be visible
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
    };
  }, [fontSize, fontFamily, cursorStyle, cursorBlink, scrollback, onData, onResize]);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: 300,
        border: '1px solid var(--ov-border-default)',
        borderRadius: '6px',
        overflow: 'hidden',
        bgcolor: '#0d1117',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      }}
    />
  );
});

Terminal.displayName = 'Terminal';

export default Terminal;
