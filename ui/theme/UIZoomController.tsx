import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTheme, type ThemeTextSize } from '@omniviewdev/base-ui';
import { HOST_SETTINGS_SCOPE, showAppError, useScopedSettings, useSnackbar } from '@omniviewdev/runtime';
import { Events } from '@omniviewdev/runtime/runtime';

const TEXT_SIZES: readonly ThemeTextSize[] = ['80', '90', '100', '110', '125'];
type ZoomAction = 'in' | 'out' | 'reset';

export default function UiZoomController({ children }: { children: ReactNode }): ReactNode {
  const { textSize } = useTheme();
  const { commit } = useScopedSettings(HOST_SETTINGS_SCOPE);
  const { showSnackbar } = useSnackbar();
  const saving = useRef(false);
  const index = TEXT_SIZES.indexOf(textSize);
  const change = useCallback((action: ZoomAction) => {
    if (saving.current) {
      return;
    }

    const next = action === 'reset' ? '100' : TEXT_SIZES[index + (action === 'in' ? 1 : -1)];
    if (!next || next === textSize) {
      return;
    }

    saving.current = true;
    void commit({ 'appearance.textSize': next }).then((result) => {
      if (!result.applied || result.uncertain) {
        showSnackbar(result.message || 'Text size saved, but could not be applied completely.', 'warning');
      }
    }).catch((error: unknown) => {
      showAppError(showSnackbar, error, 'Failed to save UI text size');
    }).finally(() => {
      saving.current = false;
    });
  }, [commit, index, showSnackbar, textSize]);

  useEffect(() => {
    // Native menu actions are emitted only to the window that owns the menu action.
    const offIn = Events.On('menu/view/zoom/in', () => {
      change('in');
    });
    const offOut = Events.On('menu/view/zoom/out', () => {
      change('out');
    });
    const offReset = Events.On('menu/view/zoom/reset', () => {
      change('reset');
    });

    return () => {
      offIn();
      offOut();
      offReset();
    };
  }, [change]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey === event.metaKey) {
        return;
      }
      // Editors and terminals retain their own content-font shortcuts.

      if (event.target instanceof Element && event.target.closest('.monaco-editor, .xterm')) {
        return;
      }

      let action: ZoomAction;
      if (event.key === '+' || event.key === '=') {
        action = 'in';
      } else if (event.key === '-' && !event.shiftKey) {
        action = 'out';
      } else if (event.key === '0' && !event.shiftKey) {
        action = 'reset';
      } else {
        return;
      }

      event.preventDefault();
      if (!event.repeat) {
        change(action);
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [change]);

  return children;
}
