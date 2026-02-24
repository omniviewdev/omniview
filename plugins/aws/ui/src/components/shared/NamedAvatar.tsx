import React from 'react'
import { Avatar } from '@omniviewdev/ui';
import { stringToColor } from '../../utils/color';

type Props = {
  value?: string
}

function stringAvatar(name: string) {
  if (!name) {
    return {
      sx: { bgcolor: 'grey.500', borderRadius: 6 },
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

const NamedAvatar: React.FC<Props> = ({ value = '' }) => {
  return (
    <Avatar size='sm'{...stringAvatar(value)} />
  )
}

export default NamedAvatar
