import React from 'react';

import { Avatar } from '@omniviewdev/ui';
import { stringToColor } from '../../utils/color';

type Props = {
  value?: string;
  color?: string;
};

/**
 * Calculates the props to return for the avatar
 * to get a deterministic naming and color.
 */
function stringAvatar(name: string) {
  if (!name) {
    return { sx: { bgcolor: 'grey.500' }, children: 'NA' };
  }

  if (name.length === 1) {
    return { sx: { bgcolor: stringToColor(name) }, children: name.toUpperCase() };
  }

  // Try splitting on space, then dash
  let parts = name.split(' ');
  if (parts.length === 1) parts = name.split('-');

  const initials =
    parts.length > 1
      ? `${parts[0][0].toUpperCase()}${parts[1][0].toUpperCase()}`
      : `${name[0].toUpperCase()}${name[1].toUpperCase()}`;

  return { sx: { bgcolor: stringToColor(name) }, children: initials };
}

/**
 * Renders an avatar with deterministic initials and color derived from the name.
 */
const NamedAvatar: React.FC<Props> = ({ value = '', color }) => {
  const avatarProps = stringAvatar(value);
  if (color) {
    avatarProps.sx = { ...avatarProps.sx, bgcolor: color };
  }
  return <Avatar size="sm" {...avatarProps} />;
};

export default NamedAvatar;
