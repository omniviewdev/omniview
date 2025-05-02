import tinycolor from 'tinycolor2';

/**
 * Generate a dterministic random color based on an input string
 */
export function stringToColor(string: string, alpha = 0.5) {
  let hash = 0;
  let i;


  for (i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = '#';

  for (i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.slice(-2);
  }


  return tinycolor(color).setAlpha(alpha).toString();
}

export function stringAvatar(name: string) {
  if (!name) {
    return {
      sx: {
        bgcolor: '#f44336',
        borderRadius: 6,
      },
      children: 'NA',
    };
  }

  if (name.length === 1) {
    return {
      sx: {
        bgcolor: stringToColor(name),
        borderRadius: 6,
      },
      children: name.toUpperCase(),
    };
  }

  // Try splitting on space
  let nameArr = name.split(' ');
  if (nameArr.length === 1) {
    // Try splitting on dash
    nameArr = name.split('-');
  }

  if (nameArr.length === 1) {
    return {
      sx: {
        maxHeight: 28,
        maxWidth: 28,
        bgcolor: stringToColor(name),
        borderRadius: 6,
      },
      children: `${name[0].toUpperCase()}${name[1].toUpperCase()}`,
    };
  }

  return {
    sx: {
      maxHeight: 28,
      maxWidth: 28,
      bgcolor: stringToColor(name),
      borderRadius: 6,
    },
    children: `${nameArr[0][0].toUpperCase()}${nameArr[1][0].toUpperCase()}`,
  };
}
