import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { Endpoints } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: Endpoints;
}

/**
 * Renders a sidebar for a Endpoints resource
 */
export const EndpointsSidebar: React.FC<Props> = ({ data }) => {
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

EndpointsSidebar.displayName = "EndpointsSidebar";
export default EndpointsSidebar;
