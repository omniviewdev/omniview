import { describe, expect, it } from 'vitest';
import { pageOfTarget } from './target';

describe('pageOfTarget', () => {
  it('reads the category of a settings route', () => {
    expect(pageOfTarget('/settings?category=terminal')).toBe('terminal');
    expect(pageOfTarget('/settings?category=developer&setting=developer.pprof_port')).toBe('developer');
    expect(pageOfTarget('/settings?section=core&category=general#x')).toBe('general');
  });

  it('addresses the installed plugin, preserving its id rather than selecting a same-named core category', () => {
    expect(pageOfTarget('/settings?section=plugins&plugin=terminal&category=general')).toBe('plugin/terminal');
    expect(pageOfTarget('/settings?section=plugins&plugin=a%2Fb.x&setting=raw.key')).toBe('plugin/a/b.x');
  });

  it('says nothing for a route that names no page, or a name that cannot be one', () => {
    expect(pageOfTarget('')).toBeUndefined();
    expect(pageOfTarget('/settings')).toBeUndefined();
    expect(pageOfTarget('/settings?section=plugins&category=terminal')).toBeUndefined();
    expect(pageOfTarget('/settings?category=')).toBeUndefined();
    expect(pageOfTarget(`/settings?category=${'x'.repeat(300)}`)).toBeUndefined();
  });
});
