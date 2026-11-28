import { describe, expect, it } from 'vitest';
import type { Platform } from '../../../core/chords';
import { followsWith, followWords, isOwnServer, isWebAddress } from './links';

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

// The host's own server (#696 step 1). In server mode the app is a page served from the host's port, and a link that points back at that port is an open redirect to the host's loopback API: a program prints it, the person
// follows it, and the system browser sends a request the person never meant. A dev server on any other port is the commonest link there is and stays followable.
describe('the host\'s own server', () => {
  const page = { protocol: 'http:', hostname: 'localhost', port: '34115' };

  it.each([
    'http://localhost:34115/',
    'http://localhost:34115/api/anything?x=1',
    'HTTP://LOCALHOST:34115/',
    'http://127.0.0.1:34115/',
    'http://127.1:34115/',
    'http://2130706433:34115/',
    'http://0x7f.0.0.1:34115/',
    'http://[::1]:34115/',
    'http://[::ffff:127.0.0.1]:34115/',
    'http://0.0.0.0:34115/',
    'http://[::]:34115/',
    'http://app.localhost:34115/',
    'http://localhost.:34115/',
    'http://user:pass@localhost:34115/',
  ])('is %s: a link to it is refused', (uri) => {
    expect(isOwnServer(uri, page)).toBe(true);
  });

  it.each([
    ['a dev server on another loopback port', 'http://localhost:3000/'],
    ['a loopback address on another port', 'http://127.0.0.1:8080/health'],
    ['a loopback address with no port (80)', 'http://localhost/'],
    ['another host on the host\'s port', 'http://example.com:34115/'],
    ['a host whose name only ends like the loopback name', 'http://notlocalhost:34115/'],
    ['the same port on https, which is another port', 'https://localhost:34115/'],
  ])('is not %s', (_what, uri) => {
    expect(isOwnServer(uri, page)).toBe(false);
  });

  it('knows the default ports: a page on port 80 is hit by a link with no port, and by one that says 80', () => {
    const plain = { protocol: 'http:', hostname: 'localhost', port: '' };
    expect(isOwnServer('http://localhost/', plain)).toBe(true);
    expect(isOwnServer('http://127.0.0.1:80/', plain)).toBe(true);
    expect(isOwnServer('https://localhost/', plain)).toBe(false);
    expect(isOwnServer('https://localhost:443/', { protocol: 'https:', hostname: 'localhost', port: '' })).toBe(true);
  });

  it('refuses the page\'s own origin whatever its host is called: a server reached over the network is its own API too', () => {
    const remote = { protocol: 'https:', hostname: 'omniview.example.com', port: '8443' };
    expect(isOwnServer('https://omniview.example.com:8443/api', remote)).toBe(true);
    expect(isOwnServer('https://omniview.example.com:9000/api', remote)).toBe(false);
    expect(isOwnServer('https://example.com:8443/api', remote)).toBe(false);
  });

  it('refuses a loopback link on the port of a page served from a network name too: the host listens on all of them', () => {
    const remote = { protocol: 'https:', hostname: 'omniview.example.com', port: '8443' };
    expect(isOwnServer('https://localhost:8443/', remote)).toBe(true);
  });

  it('has nothing to refuse when the window is not a web page (the native window\'s own scheme has no port to point at)', () => {
    expect(isOwnServer('http://localhost:34115/', { protocol: 'wails:', hostname: 'wails', port: '' })).toBe(false);
  });
});
