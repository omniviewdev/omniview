/** The props passed to resource sidebar components. */
export type ResourceSidebarComponentProps = {
  resource: {
    /** The ID of the resource passed in */
    id: string;
    /** The plugin that owns the resource type */
    plugin: string;
    /** The key identifying the kind of the resource */
    key: string;
    /** The object representation of the data */
    data: Record<string, unknown>;
  };
};
