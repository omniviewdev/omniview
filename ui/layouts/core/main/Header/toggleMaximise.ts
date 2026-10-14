import type React from 'react';
import { Window } from '@omniviewdev/runtime/runtime';

/**
 * Double-clicking the title bar maximises or restores the window, like a
 * native macOS title bar. Single clicks are ignored.
 */
export const toggleMaximiseOnDoubleClick: React.MouseEventHandler = (e) => {
  if (e.detail < 2) {
    return;
  }

  Window.IsMaximised().then((isMaximized) => {
    if (isMaximized) {
      Window.UnMaximise();
    } else {
      Window.Maximise();
    }
  }).catch((err) => {
    console.error(err);
  });
};
