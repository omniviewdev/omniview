import type React from 'react';
import { validateExtensionName } from '../utils';

const required = (name: string): never => {
  throw new TypeError(`${name} is required`);
};

export type ExtensionType = React.ComponentType<any>;

type AddExtension = (
  extensionName: string,
  extension?: ExtensionType
) => void;

type GetExtension = (
  extensionName: string
) => ExtensionType | undefined;

export type ExtensionRegistry = {
  addExtension: AddExtension;
  getExtension: GetExtension;
};

export type CreateExtensionRegistry = () => ExtensionRegistry;

const createExtensionRegistry = (): ExtensionRegistry => {
  const extensions: Record<string, ExtensionType>  = {};
  const addExtension: AddExtension = (extensionName, extension) => {
    extensionName = validateExtensionName(extensionName);
    if (!extension && extension !== null) {
      return required('extension');
    }

    extensions[extensionName.toLowerCase()] = extension;
  };

  const getExtension: GetExtension = (extensionName) => {
    extensionName = validateExtensionName(extensionName);
    return extensions[extensionName.toLowerCase()];
  };

  return  {
    addExtension,
    getExtension,
  };
};

const defaultRegistry = createExtensionRegistry();

export { createExtensionRegistry, defaultRegistry as default };
