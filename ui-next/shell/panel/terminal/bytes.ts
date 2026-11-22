// What crosses the Wails boundary (docs/ui-next/optimisations.md HLT-27; the old terminal did this with a base64 library and a decoder per event): a Go `[]byte` is base64 text in JSON, in both directions.
// The bytes of a pty read go to the emulator as bytes, never as text: an emulator keeps its own state across a multi-byte character cut between two reads, and a text decoder that is not told to stream
// would corrupt it. The engines that have the platform's own base64 (`Uint8Array.fromBase64`, `toBase64`) use it; the others do it with `atob` and `btoa`.

type Base64Platform = { readonly fromBase64?: ((text: string) => Uint8Array) | undefined };
type Base64Bytes = { readonly toBase64?: (() => string) | undefined };

/** The bytes a base64 text holds. */
export function decodeBase64(text: string): Uint8Array {
  const platform = Uint8Array as unknown as Base64Platform;
  if (typeof platform.fromBase64 === 'function') {
    return platform.fromBase64(text);
  }

  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/** How many bytes a base64 text holds, without decoding it: four characters are three bytes, less one for each `=` of padding. */
export function base64Size(text: string): number {
  if (text === '') {
    return 0;
  }

  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return (text.length / 4) * 3 - padding;
}

/** A slice of `btoa`'s input that stays far under the engines' limit on the arguments of one call. */
const SLICE = 0x8000;

/** What the user typed or pasted, as the base64 of its UTF-8 bytes: what `WriteSession` takes. */
export function encodeInput(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const own = bytes as unknown as Base64Bytes;
  if (typeof own.toBase64 === 'function') {
    return own.toBase64();
  }

  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + SLICE));
  }

  return btoa(binary);
}
