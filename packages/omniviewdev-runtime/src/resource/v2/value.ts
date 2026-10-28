import type { Value } from './domain';

/** Presentation projection only: exact safe integers are numbers; wider integers stay bigint. */
export function valueToJSON(value: Value): unknown {
  switch (value.kind) {
    case 'null': return null;
    case 'bool': case 'string': case 'double': case 'timestamp': return value.value;
    case 'int64': case 'uint64': {
      const integer = BigInt(value.value);
      return integer >= -9007199254740991n && integer <= 9007199254740991n ? Number(integer) : integer;
    }
    case 'list': return value.value.map(valueToJSON);
    case 'map': return Object.fromEntries(Object.entries(value.value).map(([key, item]) => [key, valueToJSON(item)]));
  }
}

function unicodeString(value: string): string {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Resource strings require valid Unicode');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('Resource strings require valid Unicode');
    }
  }
  return value;
}

function integerValue(decimal: string): Value {
  const value = BigInt(decimal);
  if (value >= -(1n << 63n) && value <= (1n << 63n) - 1n) return { kind: 'int64', value: value.toString() };
  if (value >= 0n && value <= (1n << 64n) - 1n) return { kind: 'uint64', value: value.toString() };
  throw new RangeError('Integer exceeds the resource Value range');
}

/** Convert authored values. Unsafe integer numbers must be supplied as bigint. */
export function jsonToValue(input: unknown): Value {
  if (input === null) return { kind: 'null' };
  if (typeof input === 'boolean') return { kind: 'bool', value: input };
  if (typeof input === 'string') return { kind: 'string', value: unicodeString(input) };
  if (typeof input === 'bigint') return integerValue(input.toString());
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TypeError('Resource values require finite numbers');
    if (Number.isInteger(input) && !Object.is(input, -0)) {
      if (!Number.isSafeInteger(input)) throw new RangeError('Use bigint for exact resource integers');
      return integerValue(input.toString());
    }
    return { kind: 'double', value: input };
  }
  if (Array.isArray(input)) return { kind: 'list', value: input.map(jsonToValue) };
  if (typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) {
    return { kind: 'map', value: Object.fromEntries(Object.entries(input).map(([key, item]) => [unicodeString(key), jsonToValue(item)])) };
  }
  throw new TypeError('Unsupported resource value');
}

/** JSON editor text preserves integer literals without stringifying them. */
export function valueToJSONText(value: Value): string {
  switch (value.kind) {
    case 'null': return 'null';
    case 'bool': case 'string': case 'timestamp': return JSON.stringify(value.value);
    case 'int64': case 'uint64': return value.value;
    case 'double': {
      if (!Number.isFinite(value.value)) throw new TypeError('Resource values require finite numbers');
      if (Object.is(value.value, -0)) return '-0.0';
      const text = JSON.stringify(value.value);
      return /[.eE]/.test(text) ? text : `${text}.0`;
    }
    case 'list': return `[${value.value.map(valueToJSONText).join(',')}]`;
    case 'map': return `{${Object.entries(value.value).map(([key, item]) => `${JSON.stringify(key)}:${valueToJSONText(item)}`).join(',')}}`;
  }
}

/** Parse editor JSON without routing integer lexemes through JS number. */
export function jsonTextToValue(text: string): Value {
  let offset = 0;
  const fail = (): never => { throw new SyntaxError(`Invalid resource JSON at offset ${offset}`); };
  const whitespace = () => { while (offset < text.length && /[\t\n\r ]/.test(text[offset])) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') { offset++; continue; }
      if (char === '"') return unicodeString(JSON.parse(text.slice(start, offset)) as string);
    }
    return fail();
  };
  const parse = (depth: number): Value => {
    if (depth > 64) throw new RangeError('Resource JSON exceeds maximum depth');
    whitespace();
    const char = text[offset];
    if (char === '"') return { kind: 'string', value: string() };
    if (char === '[') {
      offset++; whitespace();
      const values: Value[] = [];
      if (text[offset] === ']') { offset++; return { kind: 'list', value: values }; }
      while (offset < text.length) {
        values.push(parse(depth + 1)); whitespace();
        if (text[offset] === ']') { offset++; return { kind: 'list', value: values }; }
        if (text[offset++] !== ',') return fail();
      }
      return fail();
    }
    if (char === '{') {
      offset++; whitespace();
      const entries: [string, Value][] = [];
      const keys = new Set<string>();
      if (text[offset] === '}') { offset++; return { kind: 'map', value: {} }; }
      while (offset < text.length) {
        whitespace(); if (text[offset] !== '"') return fail();
        const key = string();
        if (keys.has(key)) throw new SyntaxError(`Duplicate resource JSON key: ${key}`);
        keys.add(key); whitespace();
        if (text[offset++] !== ':') return fail();
        entries.push([key, parse(depth + 1)]); whitespace();
        if (text[offset] === '}') { offset++; return { kind: 'map', value: Object.fromEntries(entries) }; }
        if (text[offset++] !== ',') return fail();
      }
      return fail();
    }
    for (const [token, value] of [['null', { kind: 'null' }], ['true', { kind: 'bool', value: true }], ['false', { kind: 'bool', value: false }]] as const) {
      if (text.startsWith(token, offset)) { offset += token.length; return value; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset));
    if (!number) return fail();
    offset += number[0].length;
    if (!/[.eE]/.test(number[0]) && number[0] !== '-0') return integerValue(number[0]);
    const value = Number(number[0]);
    if (!Number.isFinite(value)) throw new RangeError('Resource JSON number must be finite');
    return { kind: 'double', value };
  };
  const result = parse(0);
  whitespace();
  if (offset !== text.length) return fail();
  return result;
}
