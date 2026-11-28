import type { Platform } from '../../../core/chords';

// The rules of a link in a terminal's output (T3a), as pure functions: the words a hover says, which click follows the link, and which addresses are followed at all. The hook (`useTerminalLinks.tsx`) draws the words
// and hands the address to the registry; the emulator only finds the link and reports the pointer.

/**
 * What a hover on a link says, in VS Code's own words (`terminalLinkManager.ts`: "Follow link", then the click that does it): Command and a click on a Mac, Control and a click elsewhere. The link is not followed by a plain click,
 * which is how a person selects text in the output, so the words must name the click that is.
 */
export function followWords(platform: Platform): string {
  return `Follow link (${platform === 'mac' ? 'cmd' : 'ctrl'} + click)`;
}

/** What a file link copies: its path, with the line and the column when the text gave them (`/work/src/a.go:12:3`). */
export function copiedText(link: { readonly path: string; readonly line?: number | undefined; readonly col?: number | undefined }): string {
  if (link.line === undefined) {
    return link.path;
  }

  return link.col === undefined ? `${link.path}:${String(link.line)}` : `${link.path}:${String(link.line)}:${String(link.col)}`;
}

/** What a hover on a file link says: the click copies the path until an editor opens files (#696 step 5), and the words name that click as `followWords` names the web link's. */
export function copyWords(platform: Platform): string {
  return `Copy path (${platform === 'mac' ? 'cmd' : 'ctrl'} + click)`;
}

/** Where in a file a link goes, as a hover says it: `line 12, column 3`, `line 12`, or nothing when the text gave no line. */
export function positionWords(link: { readonly line?: number | undefined; readonly col?: number | undefined }): string | undefined {
  if (link.line === undefined) {
    return undefined;
  }

  return link.col === undefined ? `line ${String(link.line)}` : `line ${String(link.line)}, column ${String(link.col)}`;
}

/**
 * Whether a click follows the link it is on. The emulator gives a click on a link to the host as it came, whatever keys were held: the host asks for Command on a Mac and Control elsewhere (VS Code's test, `isMacintosh ?
 * event.metaKey : event.ctrlKey`). Control with a click on a Mac is the secondary click, so it is not the modifier there.
 */
export function followsWith(event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>, platform: Platform): boolean {
  return platform === 'mac' ? event.metaKey : event.ctrlKey;
}

/**
 * Whether an address is one to follow: `http://` or `https://`, a host that parses, no user name or password, no space, control character or backslash anywhere, and no longer than the emulator takes (2,083). The emulator finds only
 * web addresses in the output, and the registry refuses the rest again before it asks the window to open anything, but a link can name any scheme (a program writes what it likes) and another scheme starts another program on the
 * machine, so the handler does not pass one on: `file:` among them, which the system opens with whatever is registered for the file, on the machine that runs the host. A user name is refused because it can look like a host
 * (`https://accounts.example%2Fsignin@evil.example/`): what is read before the `@` is not the host the click goes to, and nothing that writes a link means one. The slashes are asked for as the registry asks for them: the address
 * parser reads `http:example.com` as a web address.
 */
export function isWebAddress(uri: string): boolean {
  if (uri.length > MAX_ADDRESS || !/^https?:\/\/[^\s\p{Cc}\\]+$/iu.test(uri)) {
    return false;
  }

  try {
    const address = new URL(uri);
    return address.hostname !== '' && address.username === '' && address.password === '';
  } catch {
    return false;
  }
}

/** The longest address a link may have: the emulator's own limit for a hyperlink's target. */
export const MAX_ADDRESS = 2083;

/** The host of an address as the browser will read it (punycode for an international name, with its port): what a click really goes to. An address that does not parse is given back as it is. */
export function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

/** An address as a menu names it: as the browser reads it, so the scheme and the host come first and an international name shows as punycode. An address that does not parse is given back as it is. */
export function linkLabel(uri: string): string {
  try {
    return new URL(uri).href;
  } catch {
    return uri;
  }
}

/** The address of the page the terminal runs in: the parts of `location` that the host's own server is told by. */
export type Origin = Pick<Location, 'protocol' | 'hostname' | 'port'>;

const DEFAULT_PORT: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' };

/** A host name as the address parser gives it, without the brackets of an IPv6 address and without the dot that ends a fully qualified name. */
function bare(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

/**
 * Whether a host name is this computer's own: `localhost` and any name under it (the address parser and the system's resolver both send `*.localhost` to the loopback), the loopback range 127.0.0.0/8, the unspecified address that a connection
 * to is a connection to this computer (0.0.0.0, `::`), `::1`, and the IPv4 forms of the last two inside an IPv6 address (`::ffff:7f00:1`). The address parser has already turned the other spellings (`127.1`, `2130706433`, `0x7f.0.0.1`) into a dotted quad.
 */
function isLoopback(hostname: string): boolean {
  const host = bare(hostname);
  return (
    host === 'localhost'
    || host.endsWith('.localhost')
    || /^127\.\d+\.\d+\.\d+$/.test(host)
    || host === '0.0.0.0'
    || host === '::'
    || host === '::1'
    || /^::ffff:(7f[0-9a-f]{2}|0):[0-9a-f]+$/.test(host)
    || host === '::ffff:0:0'
  );
}

/**
 * Whether an address points at the host's own server (#696 step 1). In server mode the app is a page that the host serves, and the host's API is on the same port: a program that prints `http://localhost:<that port>/...` makes a link
 * whose click is a request to the host's loopback API, sent by the system's browser on the person's say-so and not on a request of their own (an open redirect to loopback). So the page's own origin is not followed, and neither is any
 * name of this computer on the page's port and scheme, whatever the page is called. A dev server on another port is the commonest link there is and stays followable. A window that is not a web page (the native window's own scheme) has
 * no port to point at.
 */
export function isOwnServer(uri: string, own: Origin): boolean {
  if (!(own.protocol in DEFAULT_PORT)) {
    return false;
  }

  let address: URL;
  try {
    address = new URL(uri);
  } catch {
    return false;
  }

  if (address.protocol !== own.protocol || (address.port || DEFAULT_PORT[address.protocol]) !== (own.port || DEFAULT_PORT[own.protocol])) {
    return false;
  }

  return bare(address.hostname) === bare(own.hostname) || isLoopback(address.hostname);
}
