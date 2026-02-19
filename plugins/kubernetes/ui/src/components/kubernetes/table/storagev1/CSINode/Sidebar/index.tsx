import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { CSINode } from "kubernetes-types/storage/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<CSINode>;
}

/**
 * Renders a sidebar for a CSINode resource
 */
export const CSINodeSidebar: React.FC<Props> = ({ ctx }) => {
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

CSINodeSidebar.displayName = "CSINodeSidebar";
export default CSINodeSidebar;
