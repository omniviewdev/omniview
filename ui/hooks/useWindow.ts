import React from 'react';
import { WindowIsFullscreen } from '@runtime/runtime';
import { useDebounce } from 'react-use';
import { GetOperatingSystem } from '@api/main/App';

export const useWindow = () => {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [platform, setPlatform] = React.useState<string>('unknown');

  React.useEffect(() => {
    GetOperatingSystem().then(os => {
      setPlatform(os);
    }).catch(() => {
      console.log('Failed to get OS');
    });
  }, []);

  // This effect is used to debounce the window size check.
  // We're using a state to track the window dimensions, which will be the dependency of our debounced effect.
  const [windowSize, setWindowSize] = React.useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Update window size state on window resize

  React.useEffect(() => {
    const handleResize = () => {
      setWindowSize(currentSize => {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;
        if (newWidth === currentSize.width && newHeight === currentSize.height) {
          return currentSize; // Return the current state to avoid re-render if dimensions haven't changed
        }

        return { width: newWidth, height: newHeight };
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Debounce effect
  // This is where we actually use `useDebounce` to delay our fullscreen check until after the window has stopped resizing for 500ms.

  useDebounce(
    () => {
      async function checkFullscreen() {
        setIsFullscreen(await WindowIsFullscreen());
      }

      checkFullscreen().catch(() => {
        console.log('Failed to check fullscreen');
      });
    },
    500,
    [windowSize], // Use the state here instead of window properties directly.
  );

  return React.useMemo(() => ({ isFullscreen, windowSize, platform }), [isFullscreen, windowSize, platform]);
};

