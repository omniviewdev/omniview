import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { CSINode } from "kubernetes-types/storage/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: CSINode;
}

/**
 * Renders a sidebar for a CSINode resource
 */
export const CSINodeSidebar: React.FC<Props> = ({ data }) => {
  if (!data) {
    return <></>
  }

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

CSINodeSidebar.displayName = "CSINodeSidebar";
export default CSINodeSidebar;
