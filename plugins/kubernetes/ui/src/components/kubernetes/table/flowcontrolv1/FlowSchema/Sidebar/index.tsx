
import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { FlowSchema } from "kubernetes-types/flowcontrol/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data: FlowSchema;
}

/**
 * Renders a sidebar for a FlowSchema resource
 */
export const FlowSchemaSidebar: React.FC<Props> = ({ data }) => {

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

FlowSchemaSidebar.displayName = "FlowSchemaSidebar";
export default FlowSchemaSidebar;
