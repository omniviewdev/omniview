// Position-unit helpers mirroring backend/pkg/resourceauthoring/units.go.
//
// The wire unit is the zero-based UTF-8 byte offset into the exact source of a
// document revision. Editors count UTF-16 code units. An offset is valid only on
// a Unicode scalar boundary: inside a multi-byte sequence there is no byte
// position, and between surrogate halves there is no UTF-16 position. Invalid
// offsets throw RangeError and are never clamped. Nothing is normalized.
import { UNIT_UTF8_BYTE } from './authoring';
import type { AuthoringEdit, AuthoringRange } from './authoring';

function scalarWidth(codePoint: number): { utf8: number; utf16: number } {
  if (codePoint < 0x80) return { utf8: 1, utf16: 1 };
  if (codePoint < 0x800) return { utf8: 2, utf16: 1 };
  if (codePoint < 0x10000) return { utf8: 3, utf16: 1 };
  return { utf8: 4, utf16: 2 };
}

/** JS strings may hold lone surrogates, which have no UTF-8 form. */
function checkSource(source: string): void {
  for (let index = 0; index < source.length; index++) {
    const unit = source.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < source.length ? source.charCodeAt(index + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) throw new RangeError('Source is not valid UTF-16.');
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new RangeError('Source is not valid UTF-16.');
    }
  }
}

function checkOffset(offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('Offset is outside the source.');
  }
}

/** Number of UTF-8 bytes of source. */
export function utf8ByteLength(source: string): number {
  checkSource(source);
  let bytes = 0;
  for (const char of source) bytes += scalarWidth(char.codePointAt(0)!).utf8;
  return bytes;
}

/** Converts a UTF-8 byte offset to a UTF-16 code unit offset. */
export function byteToUTF16(source: string, offset: number): number {
  checkSource(source);
  checkOffset(offset);
  let bytes = 0;
  let units = 0;
  for (const char of source) {
    if (bytes === offset) return units;
    if (bytes > offset) break;
    const width = scalarWidth(char.codePointAt(0)!);
    bytes += width.utf8;
    units += width.utf16;
    if (bytes > offset) throw new RangeError('Offset splits a UTF-8 sequence.');
  }
  if (bytes === offset) return units;
  throw new RangeError('Offset is outside the source.');
}

/** Converts a UTF-16 code unit offset to a UTF-8 byte offset. */
export function utf16ToByte(source: string, units: number): number {
  checkSource(source);
  checkOffset(units);
  let bytes = 0;
  let seen = 0;
  for (const char of source) {
    if (seen === units) return bytes;
    const width = scalarWidth(char.codePointAt(0)!);
    if (seen + width.utf16 > units) throw new RangeError('Offset splits a UTF-16 surrogate pair.');
    seen += width.utf16;
    bytes += width.utf8;
  }
  if (seen === units) return bytes;
  throw new RangeError('Offset is outside the source.');
}

/** Converts a byte span to UTF-16 offsets of the same source. */
export function spanToUTF16(source: string, start: number, end: number): [number, number] {
  if (start > end) throw new RangeError('Span start is after its end.');
  return [byteToUTF16(source, start), byteToUTF16(source, end)];
}

/** Inverse of spanToUTF16. */
export function utf16SpanToByte(source: string, start: number, end: number): [number, number] {
  if (start > end) throw new RangeError('Span start is after its end.');
  return [utf16ToByte(source, start), utf16ToByte(source, end)];
}

function checkEdit(source: string, edit: Pick<AuthoringEdit, 'start' | 'end' | 'unit' | 'text'>): [number, number] {
  if (edit.unit !== UNIT_UTF8_BYTE) throw new RangeError('Edit unit is not utf8-byte.');
  checkSource(edit.text);
  const span = spanToUTF16(source, edit.start, edit.end);
  return span;
}

/** Returns source with the utf8-byte edit applied. */
export function applyEdit(
  source: string,
  edit: Pick<AuthoringEdit, 'start' | 'end' | 'unit' | 'text'>,
): string {
  const [start, end] = checkEdit(source, edit);
  return source.slice(0, start) + edit.text + source.slice(end);
}

export interface UTF16Edit {
  start: number;
  end: number;
  text: string;
  /** UTF-16 span of `text`, not of the source. */
  selection?: { start: number; end: number };
}

/** Converts a utf8-byte edit of source to UTF-16 units; the selection addresses edit.text. */
export function editToUTF16(source: string, edit: AuthoringEdit): UTF16Edit {
  const [start, end] = checkEdit(source, edit);
  const result: UTF16Edit = { start, end, text: edit.text };
  if (edit.selection) {
    const selection: AuthoringRange = edit.selection;
    if (selection.unit !== UNIT_UTF8_BYTE) throw new RangeError('Selection unit is not utf8-byte.');
    const [from, to] = spanToUTF16(edit.text, selection.start, selection.end);
    result.selection = { start: from, end: to };
  }
  return result;
}
