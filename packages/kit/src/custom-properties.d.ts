import 'react';

declare module 'react' {
  // Module augmentation has to merge into React's own interface: it cannot be a type alias, cannot be a Record and keeps its name.
  /* eslint-disable @typescript-eslint/consistent-type-definitions, @typescript-eslint/consistent-indexed-object-style, @typescript-eslint/naming-convention */
  interface CSSProperties {
    /** A custom property bound on one element: a data parameter that its CSS Module reads (`--_name`). The same member as ui-next declares. */
    [property: `--_${string}`]: string | number | undefined;
  }
  /* eslint-enable @typescript-eslint/consistent-type-definitions, @typescript-eslint/consistent-indexed-object-style, @typescript-eslint/naming-convention */
}
