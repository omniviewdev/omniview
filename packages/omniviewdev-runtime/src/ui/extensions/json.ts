// Structural limits come from the wire grammar. Check them during parsing, not after building an untrusted tree.
export const MAX_DECLARATIONS = 1024;
export const MAX_FIELDS = 64;
const MAX_BYTES = 256 * 1024;
const BYTE_LIMIT_ERROR = 'Extension manifest: expected at most 256 KiB of UTF-8';
const MAX_DEPTH = 5; // manifest → bindings → binding → when → comparison

export function unsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

// No encoding allocation and no silent replacement of an unpaired surrogate by U+FFFD.
function checkSize(text: string): void {
  if (typeof text !== 'string') throw new Error('Extension manifest: expected UTF-8 JSON text');
  if (text.length > MAX_BYTES) throw new Error(BYTE_LIMIT_ERROR);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes++;
    else if (unit < 0x800) bytes += 2;
    else if (unit < 0xd800 || unit > 0xdfff) bytes += 3;
    else {
      const low = text.charCodeAt(++i);
      if (unit > 0xdbff || !(low >= 0xdc00 && low <= 0xdfff)) {
        throw new Error('Extension manifest: expected well-formed Unicode');
      }
      bytes += 4;
    }
    if (bytes > MAX_BYTES) throw new Error(BYTE_LIMIT_ERROR);
  }
}

/** JSON.parse discards duplicate members before its reviver runs. Read each decoded key before accepting its value. */
export function parseManifestJson(text: string): unknown {
  checkSize(text);
  let pos = 0;
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

  function fail(expected: string): never {
    // Offsets and expectations only. Do not echo untrusted IDs, labels or fragments of the source.
    throw new Error(`Extension manifest JSON at offset ${pos}: expected ${expected}`);
  }

  function whitespace(): void {
    while (text[pos] === ' ' || text[pos] === '\n' || text[pos] === '\r' || text[pos] === '\t') pos++;
  }

  function string(): string {
    const start = pos++;
    let escaped = false;
    while (pos < text.length) {
      const c = text.charCodeAt(pos++);
      if (c === 0x22) {
        if (!escaped) return text.slice(start + 1, pos - 1);
        // Let the engine decode JSON escapes in this token only. Never expose its source-bearing SyntaxError.
        let result: string;
        try { result = JSON.parse(text.slice(start, pos)) as string; }
        catch { return fail('a valid JSON string escape'); }
        if (/[\uD800-\uDFFF]/u.test(result)) fail('well-formed Unicode');
        return result;
      }
      if (c < 0x20) fail('an escaped control character');
      if (c === 0x5c) { escaped = true; pos++; }
    }
    return fail('a closing quote');
  }

  function value(depth: number): unknown {
    whitespace();
    switch (text[pos]) {
      case '{': {
        if (depth >= MAX_DEPTH) fail(`at most ${MAX_DEPTH} nested containers`);
        pos++;
        whitespace();
        const result: Record<string, unknown> = Object.create(null);
        if (text[pos] === '}') { pos++; return result; }
        for (let count = 0; ; count++) {
          if (count >= MAX_FIELDS) fail(`at most ${MAX_FIELDS} members per object`);
          if (text[pos] !== '"') fail('a quoted member name');
          const key = string();
          if (unsafeKey(key)) fail('a safe member name');
          if (key in result) fail('unique object members');
          whitespace();
          if (text[pos++] !== ':') fail('a colon');
          result[key] = value(depth + 1);
          whitespace();
          const end = text[pos++];
          if (end === '}') return result;
          if (end !== ',') fail('a comma or closing brace');
          whitespace();
        }
      }
      case '[': {
        if (depth >= MAX_DEPTH) fail(`at most ${MAX_DEPTH} nested containers`);
        pos++;
        whitespace();
        const result: unknown[] = [];
        if (text[pos] === ']') { pos++; return result; }
        for (;;) {
          if (result.length >= MAX_DECLARATIONS) fail(`at most ${MAX_DECLARATIONS} items per list`);
          result.push(value(depth + 1));
          whitespace();
          const end = text[pos++];
          if (end === ']') return result;
          if (end !== ',') fail('a comma or closing bracket');
        }
      }
      case '"': return string();
      case 't': if (text.startsWith('true', pos)) { pos += 4; return true; } break;
      case 'f': if (text.startsWith('false', pos)) { pos += 5; return false; } break;
      case 'n': if (text.startsWith('null', pos)) { pos += 4; return null; } break;
      default: {
        number.lastIndex = pos;
        const token = number.exec(text);
        if (token !== null) {
          pos = number.lastIndex;
          const result = Number(token[0]);
          if (!Number.isFinite(result)) fail('a finite number');
          return result;
        }
      }
    }
    return fail('a JSON value');
  }

  const root = value(0);
  whitespace();
  if (pos !== text.length) fail('end of input');
  return root;
}
