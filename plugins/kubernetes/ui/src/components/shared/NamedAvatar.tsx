import React from 'react'

import {
  Avatar,
} from '@mui/joy';
import { stringToColor } from '../../utils/color';

type Props = {
  value?: string
  color?: string
}

/**
 * Calculates the props to return for the avatar
 * to get a deterministic nameing and color
 */
function stringAvatar(name: string) {
  if (!name) {
    return {
      sx: {
        bgcolor: 'grey.500',
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

/**
 * Renders an avatar with names and a deterministic color
 */
const NamedAvatar: React.FC<Props> = ({ value = '', color }) => {
  const avatarProps = stringAvatar(value);
  if (color) {
    avatarProps.sx = { ...avatarProps.sx, bgcolor: color };
  }
  return (
    <Avatar size='sm'{...avatarProps} />
  )
}

export default NamedAvatar
