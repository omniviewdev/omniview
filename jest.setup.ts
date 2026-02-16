import '@testing-library/jest-dom';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';

// jsdom doesn't provide TextEncoder/TextDecoder — polyfill from Node's util
if (typeof globalThis.TextDecoder === 'undefined') {
  (globalThis as any).TextDecoder = NodeTextDecoder;
}
if (typeof globalThis.TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = NodeTextEncoder;
}
