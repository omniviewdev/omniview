import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { ResourceQuota } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data: ResourceQuota;
}

/**
 * Renders a sidebar for a ResourceQuota resource
 */
export const ResourceQuotaSidebar: React.FC<Props> = ({ data }) => {

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

ResourceQuotaSidebar.displayName = "ResourceQuotaSidebar";
export default ResourceQuotaSidebar;
