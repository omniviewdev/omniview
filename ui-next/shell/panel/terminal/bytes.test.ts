import { describe, expect, it } from 'vitest';
import { base64Size, decodeBase64, encodeInput } from './bytes';

// What crosses the Wails boundary: the host sends the bytes of a pty read as base64 text (a Go `[]byte` in JSON), and takes what the user typed as base64 of its UTF-8 bytes. Both directions are
// byte exact: the emulator keeps its own state across a multi-byte character cut between two chunks, so nothing here may decode text.

const every = Uint8Array.from({ length: 256 }, (_, index) => index);

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }

  return btoa(text);
}

describe('decoding the base64 text of a chunk', () => {
  it('gives the bytes back, whatever they are: all 256 values, none of them text', () => {
    expect(decodeBase64(toBase64(every))).toEqual(every);
  });

  it('gives nothing for nothing', () => {
    expect(decodeBase64('')).toEqual(new Uint8Array(0));
  });

  it('keeps a character that was cut between two chunks as the bytes it is: the first half and the second are not text and join to the character', () => {
    const bytes = new TextEncoder().encode('é😀');
    const joined = new Uint8Array([...decodeBase64(toBase64(bytes.slice(0, 3))), ...decodeBase64(toBase64(bytes.slice(3)))]);
    expect(new TextDecoder().decode(joined)).toBe('é😀');
  });

  it('is the same with the platform\'s own decoder and without it (engines before it carry it: `atob` does the work)', () => {
    const text = toBase64(every);
    const native = decodeBase64(text);
    const platform = Uint8Array as unknown as { fromBase64?: unknown };
    const saved = platform.fromBase64;
    platform.fromBase64 = undefined;
    try {
      expect(decodeBase64(text)).toEqual(native);
    } finally {
      platform.fromBase64 = saved;
    }
  });

  it('decodes a megabyte', () => {
    const big = new Uint8Array(1 << 20).map((_, index) => (index * 31) & 0xff);
    expect(decodeBase64(toBase64(big))).toEqual(big);
  });
});

describe('the size of a chunk before it is decoded', () => {
  it('is the number of bytes the text holds, padding counted out', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 255, 256, 20_480]) {
      expect(base64Size(toBase64(Uint8Array.from({ length }, (_, index) => index & 0xff)))).toBe(length);
    }
  });
});

describe('encoding what the user typed', () => {
  it('is the base64 of its UTF-8 bytes, one for every character of every width', () => {
    for (const text of ['', 'a', 'ls -la\r', 'é', '日本語', '😀', 'a😀b', '\u001b[A', '\u0003']) {
      expect(atob(encodeInput(text))).toBe(String.fromCharCode(...new TextEncoder().encode(text)));
    }
  });

  it('handles a paste of a megabyte without running out of stack', () => {
    const text = 'x'.repeat(1 << 20);
    expect(atob(encodeInput(text)).length).toBe(1 << 20);
  });

  it('is the same with the platform\'s own encoder and without it', () => {
    const text = 'ls é 😀\r';
    const native = encodeInput(text);
    const proto = Uint8Array.prototype as unknown as { toBase64?: unknown };
    const saved = proto.toBase64;
    proto.toBase64 = undefined;
    try {
      expect(encodeInput(text)).toBe(native);
    } finally {
      proto.toBase64 = saved;
    }
  });
});
