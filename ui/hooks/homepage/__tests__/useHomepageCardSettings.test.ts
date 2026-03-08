import { renderHook, act } from '@testing-library/react';
import { useHomepageCardSettings } from '../useHomepageCardSettings';
import type { HomepageCardConfig } from '@omniviewdev/runtime';

// localStorage is available in jsdom; clear it between tests
beforeEach(() => {
  localStorage.clear();
});

describe('useHomepageCardSettings', () => {
  describe('default state', () => {
    it('starts with empty order, hidden, and configs', () => {
      const { result } = renderHook(() => useHomepageCardSettings());
      expect(result.current.settings.order).toEqual([]);
      expect(result.current.settings.hidden).toEqual([]);
      expect(result.current.settings.configs).toEqual({});
    });
  });

  describe('setOrder', () => {
    it('updates the order and persists to localStorage', () => {
      const { result } = renderHook(() => useHomepageCardSettings());

      act(() => {
        result.current.setOrder(['a', 'b', 'c']);
      });

      expect(result.current.settings.order).toEqual(['a', 'b', 'c']);
      const stored = JSON.parse(localStorage.getItem('omniview:homepage:cards')!);
      expect(stored.order).toEqual(['a', 'b', 'c']);
    });

    it('survives a remount (reads from localStorage)', () => {
      const { result: r1 } = renderHook(() => useHomepageCardSettings());
      act(() => {
        r1.current.setOrder(['x', 'y']);
      });

      const { result: r2 } = renderHook(() => useHomepageCardSettings());
      expect(r2.current.settings.order).toEqual(['x', 'y']);
    });
  });

  describe('toggleHidden', () => {
    it('adds an ID to hidden when not already hidden', () => {
      const { result } = renderHook(() => useHomepageCardSettings());

      act(() => {
        result.current.toggleHidden('card-1');
      });

      expect(result.current.isHidden('card-1')).toBe(true);
      expect(result.current.settings.hidden).toContain('card-1');
    });

    it('removes an ID from hidden when already hidden', () => {
      const { result } = renderHook(() => useHomepageCardSettings());

      act(() => {
        result.current.toggleHidden('card-1');
      });
      act(() => {
        result.current.toggleHidden('card-1');
      });

      expect(result.current.isHidden('card-1')).toBe(false);
      expect(result.current.settings.hidden).not.toContain('card-1');
    });

    it('persists hidden state to localStorage', () => {
      const { result } = renderHook(() => useHomepageCardSettings());

      act(() => {
        result.current.toggleHidden('card-2');
      });

      const stored = JSON.parse(localStorage.getItem('omniview:homepage:cards')!);
      expect(stored.hidden).toContain('card-2');
    });
  });

  describe('isHidden', () => {
    it('returns false for cards not in the hidden list', () => {
      const { result } = renderHook(() => useHomepageCardSettings());
      expect(result.current.isHidden('unknown-card')).toBe(false);
    });
  });

  describe('updateCardConfig / getCardConfig', () => {
    const defaultConfig: HomepageCardConfig = { sections: ['recent', 'favorites'], maxItems: 5 };

    it('returns defaultConfig when no override exists', () => {
      const { result } = renderHook(() => useHomepageCardSettings());
      expect(result.current.getCardConfig('card-1', defaultConfig)).toEqual(defaultConfig);
    });

    it('returns the user override when one exists', () => {
      const { result } = renderHook(() => useHomepageCardSettings());
      const override: HomepageCardConfig = { sections: ['recent'], maxItems: 3 };

      act(() => {
        result.current.updateCardConfig('card-1', override);
      });

      expect(result.current.getCardConfig('card-1', defaultConfig)).toEqual(override);
    });

    it('persists config override to localStorage', () => {
      const { result } = renderHook(() => useHomepageCardSettings());
      const override: HomepageCardConfig = { sections: ['favorites'], maxItems: 10 };

      act(() => {
        result.current.updateCardConfig('card-A', override);
      });

      const stored = JSON.parse(localStorage.getItem('omniview:homepage:cards')!);
      expect(stored.configs['card-A']).toEqual(override);
    });

    it('overrides only the specified card without affecting others', () => {
      const { result } = renderHook(() => useHomepageCardSettings());

      act(() => {
        result.current.updateCardConfig('card-1', { sections: ['recent'], maxItems: 2 });
        result.current.updateCardConfig('card-2', { sections: ['favorites'], maxItems: 7 });
      });

      expect(result.current.getCardConfig('card-1', defaultConfig).maxItems).toBe(2);
      expect(result.current.getCardConfig('card-2', defaultConfig).maxItems).toBe(7);
    });
  });

  describe('order sync semantics', () => {
    it('setOrder does not affect hidden or configs', () => {
      const { result } = renderHook(() => useHomepageCardSettings());

      act(() => {
        result.current.toggleHidden('card-1');
        result.current.updateCardConfig('card-2', { sections: ['recent'], maxItems: 3 });
      });

      act(() => {
        result.current.setOrder(['card-1', 'card-2']);
      });

      expect(result.current.isHidden('card-1')).toBe(true);
      expect(result.current.getCardConfig('card-2', { sections: [], maxItems: 5 }).maxItems).toBe(3);
    });
  });
});
