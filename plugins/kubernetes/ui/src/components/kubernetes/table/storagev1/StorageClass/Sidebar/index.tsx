import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { StorageClass } from "kubernetes-types/storage/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<StorageClass>;
}

/**
 * Renders a sidebar for a StorageClass resource
 */
export const StorageClassSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={ctx.data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

StorageClassSidebar.displayName = "StorageClassSidebar";
export default StorageClassSidebar;
