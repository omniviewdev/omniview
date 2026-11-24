import { describe, expect, it } from 'vitest';
import type { Platform } from '../../../core/chords';
import { followsWith, followWords, isWebAddress } from './links';

// The rules of a link in the terminal's output, as pure functions: what a hover says, which click follows it, and which addresses are followed at all. The hook gives them a tooltip and the registry; the rules are here.

const click = (modifiers: Partial<Pick<MouseEvent, 'metaKey' | 'ctrlKey'>> = {}): Pick<MouseEvent, 'metaKey' | 'ctrlKey'> => ({ metaKey: false, ctrlKey: false, ...modifiers });

describe('what a hover says', () => {
  it('names the chord of the platform in VS Code\'s own words: cmd on a Mac, ctrl elsewhere', () => {
    expect(followWords('mac')).toBe('Follow link (cmd + click)');
    expect(followWords('other')).toBe('Follow link (ctrl + click)');
  });
});

describe('which click follows a link', () => {
  it('is Command and a click on a Mac, and only that modifier', () => {
    expect(followsWith(click({ metaKey: true }), 'mac')).toBe(true);
    expect(followsWith(click({ ctrlKey: true }), 'mac')).toBe(false);
    expect(followsWith(click(), 'mac')).toBe(false);
  });

  it('is Control and a click on Windows and Linux, and only that modifier', () => {
    expect(followsWith(click({ ctrlKey: true }), 'other')).toBe(true);
    expect(followsWith(click({ metaKey: true }), 'other')).toBe(false);
    expect(followsWith(click(), 'other')).toBe(false);
  });

  it.each<Platform>(['mac', 'other'])('is never a plain click, which selects (%s)', (platform) => {
    expect(followsWith(click(), platform)).toBe(false);
  });
});

describe('which addresses are followed', () => {
  it.each([
    'https://example.com',
    'http://example.com/a/b?c=d#e',
    'HTTPS://EXAMPLE.COM/PATH',
    'http://localhost:3000/',
    'http://127.0.0.1:8080/health',
    'https://user@example.com:8443/x',
  ])('follows the web address %s', (uri) => {
    expect(isWebAddress(uri)).toBe(true);
  });

  it.each([
    ['a script', 'javascript:alert(1)'],
    ['a file', 'file:///etc/passwd'],
    ['a transfer address', 'ftp://example.com/file'],
    ['a data address', 'data:text/html,<script>alert(1)</script>'],
    ['a web scheme with no slashes, which the address parser would read as a web address', 'http:example.com'],
    ['a mail address', 'mailto:someone@example.com'],
    ['an address of the window\'s own scheme', 'wails://localhost/'],
    ['a relative address', '/etc/passwd'],
    ['an address with no scheme', 'example.com/path'],
    ['an address with no scheme and slashes', '//example.com/path'],
    ['a scheme with no host', 'https://'],
    ['an address that does not parse', 'http://[::1'],
    ['nothing', ''],
    ['white space', '   '],
  ])('does not follow %s', (_what, uri) => {
    expect(isWebAddress(uri)).toBe(false);
  });
});
