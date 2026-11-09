declare module 'virtual:wails-binding-index' {
  const index: Record<string, string>;
  export default index;
}

declare module 'bench-kubernetes-pod-table' {
  import type { ComponentType } from 'react';
  const PodTable: ComponentType;
  export default PodTable;
}
