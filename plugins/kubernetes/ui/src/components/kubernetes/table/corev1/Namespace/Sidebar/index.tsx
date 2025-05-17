import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { Namespace } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data: Namespace;
}

/**
 * Renders a sidebar for a Namespace resource
 */
export const NamespaceSidebar: React.FC<Props> = ({ data }) => {

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

NamespaceSidebar.displayName = "NamespaceSidebar";
export default NamespaceSidebar;
