import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { NetworkPolicy } from "kubernetes-types/networking/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: NetworkPolicy;
}

/**
 * Renders a sidebar for a NetworkPolicy resource
 */
export const NetworkPolicySidebar: React.FC<Props> = ({ data }) => {
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

NetworkPolicySidebar.displayName = "NetworkPolicySidebar";
export default NetworkPolicySidebar;
