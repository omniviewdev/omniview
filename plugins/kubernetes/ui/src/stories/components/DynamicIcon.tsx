import React from "react";
import { type IconBaseProps } from "react-icons/lib";
import { LuFileQuestion } from "react-icons/lu";

import * as Lu from "react-icons/lu";
import * as Si from "react-icons/si";

type NamedIconProps = {
  name: string;
} & IconBaseProps;

// Mapping to dynamically import icon libraries
const iconComponents = {
  Lu,
  Si,
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

export const DynamicIcon: React.FC<NamedIconProps> = ({ name, ...props }) => {
  let DynamicIcon;
  try {
    DynamicIcon = loadIconComponent(name) as React.ElementType<IconBaseProps>;
  } catch (error) {
    console.error(error);
    return (
      <>
        <LuFileQuestion />
      </>
    ); // Or any other fallback UI
  }

  return <DynamicIcon {...props} />;
};

export default DynamicIcon;
