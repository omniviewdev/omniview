export function generateErrorId(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return `ERR-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
