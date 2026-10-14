import React from 'react'
import { Avatar } from '@omniviewdev/base-ui';
import { stringToColor } from '../../utils/color';

type Props = {
  value?: string
}

/** Initials + background colour for a name (shared with other avatar call sites). */
export function avatarInitials(name: string): { initials: string; color: string } {
  if (!name) {
    return { initials: 'NA', color: 'var(--ov-color-fg-subtle)' };
  }
  if (name.length === 1) {
    return { initials: name.toUpperCase(), color: stringToColor(name) };
  }
  let nameArr = name.split(' ');
  if (nameArr.length === 1) {
    nameArr = name.split('-');
  }
  if (nameArr.length === 1) {
    return { initials: `${name[0].toUpperCase()}${name[1].toUpperCase()}`, color: stringToColor(name) };
  }
  return {
    initials: `${nameArr[0][0].toUpperCase()}${nameArr[1][0].toUpperCase()}`,
    color: stringToColor(name),
  };
}

const rootStyle: React.CSSProperties = { maxHeight: 28, maxWidth: 28, borderRadius: 6 };

/** Small rounded avatar showing initials on a colour derived from the name. */
export const InitialsAvatar: React.FC<{ name: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; style?: React.CSSProperties }> = ({ name, size = 'sm', style }) => {
  const { initials, color } = avatarInitials(name);
  return (
    <Avatar
      size={size}
      shape='rounded'
      fallback={initials}
      style={{ ...rootStyle, ...style }}
      fallbackProps={{ style: { backgroundColor: color, color: '#fff', borderRadius: 6 } }}
    />
  );
}

const NamedAvatar: React.FC<Props> = ({ value = '' }) => {
  return <InitialsAvatar name={value} />
}

export default NamedAvatar
