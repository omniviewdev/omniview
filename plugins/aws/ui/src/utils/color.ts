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

export function stringAvatar(name: string) {
  if (!name) {
    return {
      sx: { bgcolor: '#f44336', borderRadius: 6 },
      children: 'NA',
    };
  }
  if (name.length === 1) {
    return {
      sx: { bgcolor: stringToColor(name), borderRadius: 6 },
      children: name.toUpperCase(),
    };
  }
  let nameArr = name.split(' ');
  if (nameArr.length === 1) {
    nameArr = name.split('-');
  }
  if (nameArr.length === 1) {
    return {
      sx: { maxHeight: 28, maxWidth: 28, bgcolor: stringToColor(name), borderRadius: 6 },
      children: `${name[0].toUpperCase()}${name[1].toUpperCase()}`,
    };
  }
  return {
    sx: { maxHeight: 28, maxWidth: 28, bgcolor: stringToColor(name), borderRadius: 6 },
    children: `${nameArr[0][0].toUpperCase()}${nameArr[1][0].toUpperCase()}`,
  };
}
