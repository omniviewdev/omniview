import React, { type ReactNode } from 'react';
import {
  type ExtensionRegistry,
  type ExtensionType,
  default as defaultRegistry,
} from '../ExtensionRegistry';
import { validateExtensionName } from '../utils';
import { useExtensionRegistry } from '../ExtensionProvider';

type ExtensionPointProps = {
  extensionName: string;
  children?: ReactNode | ((Extension: ExtensionType, props: any) => ReactNode);
  registry?: ExtensionRegistry;
  props?: any;
};

export type ExtentionPoint = React.FC<ExtensionPointProps>;

const ExtensionPoint = ({
  extensionName,
  children = null,
  registry: registryFromProps,
  ...props
}: ExtensionPointProps) => {
  const registry =
    useExtensionRegistry() ?? registryFromProps ?? defaultRegistry;
  const validatedExtensionName = validateExtensionName(extensionName);
  const Extension = registry?.getExtension(validatedExtensionName);

  if (typeof children === 'function') {
    return children(Extension!, props) ?? null;
  } else if (typeof Extension === 'undefined') {
    if (React.isValidElement(children)) {
      return React.cloneElement(children, props);
    } else {
      return children;
    }
  } else if (!Extension) {
    return null;
  }

  return <Extension {...props} />;
};

export default ExtensionPoint;
