export function stringToColor(string: string, alpha = 0.5) {
  let hash = 0;
  for (let i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }
  const r = (hash >> 0) & 0xff;
  const g = (hash >> 8) & 0xff;
  const b = (hash >> 16) & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
