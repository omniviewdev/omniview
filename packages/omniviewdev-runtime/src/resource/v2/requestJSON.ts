/** Transport encoding only: canonical DTOs remain unchanged, including double -0. */
export function encodeRequestJSON(input: unknown, routing: readonly string[] = []): string {
  const maxBytes = 32 << 20;
  const maxOuterBytes = (64 << 20) - (64 << 10);
  // Reserve 64 KiB for Wails method/envelope fields and routing arguments.
  let routingBytes = 0;
  for (const part of routing) {
    if (part.length > (64 << 10)) throw new RangeError('Request routing byte limit');
    routingBytes += new TextEncoder().encode(JSON.stringify(part)).length + 1;
  }
  if (routingBytes > (64 << 10) - 8192) throw new RangeError('Request routing byte limit');
  let bytes = 0;
  let outerBytes = 2;
  let nodes = 0;
  let fields = 0;
  const chunks: string[] = [];
  const append = (text: string): void => {
    for (let index = 0; index < text.length; index++) {
      const unit = text.charCodeAt(index);
      let size = unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = text.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Invalid Unicode');
        size = 4;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError('Invalid Unicode');
      bytes += size;
      outerBytes += unit === 34 || unit === 92 ? 2 : size;
      if (bytes > maxBytes || outerBytes > maxOuterBytes) throw new RangeError('Request JSON byte limit');
    }
    chunks.push(text);
  };
  const string = (value: string): void => {
    if (value.length > maxBytes) throw new RangeError('Request JSON byte limit');
    // Reject malformed Unicode before JSON.stringify can repair it into escapes.
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Invalid Unicode');
      } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError('Invalid Unicode');
    }
    append(JSON.stringify(value));
  };
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 262144 || depth > 64) throw new RangeError('Request JSON structural limit');
    if (value === null) { append('null'); return; }
    if (typeof value === 'string') { string(value); return; }
    if (typeof value === 'boolean') { append(value ? 'true' : 'false'); return; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Request numbers must be finite');
      append(Object.is(value, -0) ? '-0' : JSON.stringify(value));
      return;
    }
    if (Array.isArray(value)) {
      append('[');
      for (let index = 0; index < value.length; index++) {
        if (++fields > 1048576) throw new RangeError('Request JSON field limit');
        if (index) append(',');
        visit(value[index], depth + 1);
      }
      append(']');
      return;
    }
    if (typeof value === 'object') {
      append('{');
      let first = true;
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue; // Optional DTO fields are absent on the wire.
        if (++fields > 1048576) throw new RangeError('Request JSON field limit');
        if (!first) append(',');
        first = false;
        string(key); append(':'); visit(item, depth + 1);
      }
      append('}');
      return;
    }
    throw new TypeError('Unsupported request JSON value');
  };
  visit(input, 0);
  return chunks.join('');
}
