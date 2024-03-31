import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { Endpoints } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../shared/ObjectMetaSection";

interface Props {
  data: object;
}

/**
 * Renders a sidebar for a ConfigMap resource
 */
export const EndpointSidebar: React.FC<Props> = ({ data }) => {
  if (!data) {
    return <React.Fragment />;
  }

  // assert this is a ConfigMap
  const obj = data as Endpoints;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={obj.metadata} />
    </Stack>
  );
};

EndpointSidebar.displayName = "EndpointSidebar";
export default EndpointSidebar;
