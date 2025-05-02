import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { Pod } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../shared/ObjectMetaSection";

// third-party
import ContainersSection from "./containers";

interface Props {
  data: object;
}

export const PodSidebar: React.FC<Props> = ({ data }) => {
  if (!data) {
    console.log("did not get any data")
    return <React.Fragment />;
  }

  const obj = data as Pod;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <ObjectMetaSection data={obj.metadata} />
      <ContainersSection obj={obj} />
      {/* <CodeEditor */}
      {/*   height="100vh" */}
      {/*   value={stringify(obj)} */}
      {/*   language="yaml" */}
      {/*   filename="spec.yaml" */}
      {/* /> */}
    </Stack>
  );
};

PodSidebar.displayName = "PodSidebar";
export default PodSidebar;
