import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseResizablePanelOptions {
  direction: 'horizontal' | 'vertical';
  defaultSize: number;
  minSize?: number;
  maxSize?: number;
  onResize?: (size: number) => void;
  storageKey?: string;
}

export interface UseResizablePanelReturn {
  size: number;
  isDragging: boolean;
  handleProps: {
    onMouseDown: React.MouseEventHandler;
    onDoubleClick: React.MouseEventHandler;
  };
  reset: () => void;
}

function loadSize(key: string, fallback: number): number {
  try {
    const val = localStorage.getItem(key);
    return val ? Number(val) : fallback;
  } catch {
    return fallback;
  }
}

function saveSize(key: string, size: number) {
  try {
    localStorage.setItem(key, String(size));
  } catch {
    // ignore
  }
}

export default function useResizablePanel({
  direction,
  defaultSize,
  minSize = 0,
  maxSize = Infinity,
  onResize,
  storageKey,
}: UseResizablePanelOptions): UseResizablePanelReturn {
  const [size, setSize] = useState(() =>
    storageKey ? loadSize(storageKey, defaultSize) : defaultSize,
  );
  const [isDragging, setIsDragging] = useState(false);
  const startRef = useRef({ pos: 0, size: 0 });

  const clamp = useCallback(
    (val: number) => Math.max(minSize, Math.min(maxSize, val)),
    [minSize, maxSize],
  );

  const handleMouseDown: React.MouseEventHandler = useCallback(
    (e) => {
      e.preventDefault();
      const pos = direction === 'horizontal' ? e.clientX : e.clientY;
      startRef.current = { pos, size };
      setIsDragging(true);
    },
    [direction, size],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => {
      const pos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = pos - startRef.current.pos;
      const next = clamp(startRef.current.size + delta);
      setSize(next);
      onResize?.(next);
    };

    const handleUp = () => {
      setIsDragging(false);
      if (storageKey) {
        saveSize(storageKey, size);
      }
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, direction, clamp, onResize, storageKey, size]);

  const handleDoubleClick: React.MouseEventHandler = useCallback(() => {
    const next = size === minSize ? defaultSize : minSize;
    const clamped = clamp(next);
    setSize(clamped);
    onResize?.(clamped);
    if (storageKey) saveSize(storageKey, clamped);
  }, [size, minSize, defaultSize, clamp, onResize, storageKey]);

  const reset = useCallback(() => {
    setSize(defaultSize);
    onResize?.(defaultSize);
    if (storageKey) saveSize(storageKey, defaultSize);
  }, [defaultSize, onResize, storageKey]);

  return {
    size,
    isDragging,
    handleProps: {
      onMouseDown: handleMouseDown,
      onDoubleClick: handleDoubleClick,
    },
    reset,
  };
}
