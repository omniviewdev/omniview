import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { EndpointSlice } from "kubernetes-types/discovery/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: EndpointSlice;
}

/**
 * Renders a sidebar for a EndpointSlice resource
 */
export const EndpointSliceSidebar: React.FC<Props> = ({ data }) => {
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

EndpointSliceSidebar.displayName = "EndpointSliceSidebar";
export default EndpointSliceSidebar;
