
export type ResourceViewRegistry<T> = {
  register(opts: T): void;
  unregister(id: string): void;
  get(id: string): T | undefined;
  getViews(plugin: string, resource: string): T[];
};
