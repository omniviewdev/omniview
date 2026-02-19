import React from 'react';
import { type IconBaseProps } from 'react-icons/lib';
import { LuFileQuestion } from 'react-icons/lu';

import * as Si from 'react-icons/si';
import * as Lu from 'react-icons/lu';

type NamedIconProps = {
  name: string;
} & IconBaseProps;

const iconComponents = {
  Si,
  Lu,
};

const loadIconComponent = (name: string) => {
  const prefix = name.substring(0, 2) as keyof typeof iconComponents;
  const iconName = name;

  const Icons = iconComponents[prefix];
  if (!Icons) {
    throw new Error(`Icon library "${prefix}" is not supported`);
  }

  if (!Icons[iconName as keyof typeof Icons]) {
    throw new Error(`Icon "${iconName}" is not supported`);
  }

  return Icons[iconName as keyof typeof Icons];
};

export const Icon: React.FC<NamedIconProps> = ({ name, ...props }) => {
  const prefix = name.substring(0, 2);
  if (prefix === 'Lu' && !props.strokeWidth) {
    props.strokeWidth = 1.5;
  }

  let DynamicIcon;
  try {
    DynamicIcon = loadIconComponent(name) as React.ComponentType<IconBaseProps>;
  } catch (error) {
    console.error(error);
    return <LuFileQuestion {...props} />;
  }

  return <DynamicIcon {...props} />;
};

export default Icon;
