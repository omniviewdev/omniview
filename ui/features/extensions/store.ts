import { ExtensionPointRegistry } from '@omniviewdev/runtime';
import initialStores from './builtin'

export const EXTENSION_REGISTRY = new ExtensionPointRegistry({ initialStores });

