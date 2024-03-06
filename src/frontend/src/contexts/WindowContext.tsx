import React from 'react';

// Create a context with a default value
export const WindowContext = React.createContext({
  isFullscreen: false,
  windowSize: { width: window.innerWidth, height: window.innerHeight },
  platform: 'unknown',
});
