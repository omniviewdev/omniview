import React from 'react';
import { type IconBaseProps } from 'react-icons/lib';
import { LuFileQuestion } from 'react-icons/lu';

import * as Ai from 'react-icons/ai';
import * as Bs from 'react-icons/bs';
import * as Bi from 'react-icons/bi';
import * as Ci from 'react-icons/ci';
import * as Di from 'react-icons/di';
import * as Fi from 'react-icons/fi';
import * as Fc from 'react-icons/fc';
import * as Fa from 'react-icons/fa6';
import * as Gi from 'react-icons/gi';
import * as Go from 'react-icons/go';
import * as Gr from 'react-icons/gr';
import * as Hi from 'react-icons/hi2';
import * as Im from 'react-icons/im';
import * as Io from 'react-icons/io5';
import * as Md from 'react-icons/md';
import * as Pi from 'react-icons/pi';
import * as Ri from 'react-icons/ri';
import * as Si from 'react-icons/si';
import * as Sl from 'react-icons/sl';
import * as Tb from 'react-icons/tb';
import * as Lu from 'react-icons/lu';

type NamedIconProps = {
  name: string;
} & IconBaseProps;

// Mapping to dynamically import icon libraries
const iconComponents = {
  Ai,
  Bs,
  Bi,
  Ci,
  Di,
  Fi,
  Fc,
  Fa,
  Gi,
  Go,
  Gr,
  Hi,
  Im,
  Io,
  Md,
  Pi,
  Ri,
  Si,
  Sl,
  Tb,
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
  let DynamicIcon;
  try {
    DynamicIcon = loadIconComponent(name) as any;
  } catch (error) {
    console.error(error);
    return <><LuFileQuestion /></>; // Or any other fallback UI
  }

  return (
    <DynamicIcon {...props} />
  );
};

export default Icon;

