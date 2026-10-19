import { act, render } from '@testing-library/react';
import type * as Runtime from '@omniviewdev/runtime';
import RightDrawerProvider from '../RightDrawerProvider';
import { getBottomDrawerHeight, setBottomDrawerHeight } from '../BottomDrawer/events';

vi.mock('@omniviewdev/runtime', async () => {
  const actual = await vi.importActual<typeof Runtime>('@omniviewdev/runtime');
  return { ...actual, useSnackbar: () => ({ showSnackbar: vi.fn() }) };
});

// Resource editors are a browser-only child boundary, not part of panel sizing.
vi.mock('@/federation/LinkedResourceDrawer', () => ({
  createLinkedResourceDrawer: vi.fn(),
}));

vi.mock('@/components/displays/RightDrawer', () => ({
  default: () => null,
}));

describe('RightDrawerProvider', () => {
  it('updates its own layout height without changing the document-wide drawer height', () => {
    const originalHeight = getBottomDrawerHeight();
    const globalHeight = document.documentElement.style.getPropertyValue('--BottomDrawer-height');
    const { container, unmount } = render(<RightDrawerProvider><div>content</div></RightDrawerProvider>);
    try {
      const panel = container.lastElementChild;
      if (!(panel instanceof HTMLElement)) {
        throw new Error('Right drawer panel is unavailable');
      }

      act(() => {
        setBottomDrawerHeight(550); 
      });
      expect(panel.style.getPropertyValue('--BottomDrawer-height')).toBe('550px');
      expect(document.documentElement.style.getPropertyValue('--BottomDrawer-height')).toBe(globalHeight);
      act(() => {
        setBottomDrawerHeight(220); 
      });
      expect(panel.style.getPropertyValue('--BottomDrawer-height')).toBe('220px');
      expect(document.documentElement.style.getPropertyValue('--BottomDrawer-height')).toBe(globalHeight);
    } finally {
      unmount();
      setBottomDrawerHeight(originalHeight);
    }
  });
});
