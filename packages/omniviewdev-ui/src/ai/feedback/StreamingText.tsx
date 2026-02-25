import { useState, useEffect, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface StreamingTextProps {
  text: string;
  /** Base characters per frame — actual speed varies to simulate token delivery. */
  speed?: number;
  onComplete?: () => void;
  showCursor?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * Returns a variable chunk size centered around `base` to simulate the
 * uneven cadence of token-by-token LLM output.  Chunks occasionally
 * arrive in larger bursts (3-5 chars) and sometimes pause briefly
 * (1 char), mimicking real streaming.
 */
function nextChunkSize(base: number): number {
  // Weighted random: 60% normal, 20% burst, 20% pause
  const roll = Math.random();
  if (roll < 0.2) return 1;                              // pause — single char
  if (roll > 0.8) return Math.min(base * 3, base + 4);   // burst — 3x or +4
  // Normal: ±1 jitter around base
  return Math.max(1, base + Math.round((Math.random() - 0.5) * 2));
}

export default function StreamingText({
  text,
  speed = 2,
  onComplete,
  showCursor = true,
  sx,
}: StreamingTextProps) {
  const [charIndex, setCharIndex] = useState(0);
  const rafRef = useRef<number>(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const complete = charIndex >= text.length;

  const tick = useCallback(() => {
    setCharIndex((prev) => {
      const chunk = nextChunkSize(speed);
      const next = Math.min(prev + chunk, text.length);
      if (next >= text.length) {
        onCompleteRef.current?.();
      }
      return next;
    });
  }, [speed, text.length]);

  useEffect(() => {
    if (complete) return;

    const step = () => {
      tick();
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => cancelAnimationFrame(rafRef.current);
  }, [tick, complete]);

  // Reset when text changes
  useEffect(() => {
    setCharIndex(0);
  }, [text]);

  return (
    <Box
      component="span"
      sx={{
        whiteSpace: 'pre-wrap',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {text.slice(0, charIndex)}
      {showCursor && !complete && (
        <Box
          component="span"
          data-testid="streaming-cursor"
          sx={{
            display: 'inline-block',
            width: '2px',
            height: '1.1em',
            bgcolor: 'var(--ov-accent)',
            verticalAlign: 'text-bottom',
            ml: '1px',
            borderRadius: '1px',
            animation: 'ov-ai-cursor-blink 0.8s ease-in-out infinite',
            '@keyframes ov-ai-cursor-blink': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.15 },
            },
          }}
        />
      )}
    </Box>
  );
}

StreamingText.displayName = 'StreamingText';
