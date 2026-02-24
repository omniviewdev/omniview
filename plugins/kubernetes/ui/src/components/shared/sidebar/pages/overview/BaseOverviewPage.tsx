import React from "react";

// @omniviewdev/ui
import { Stack } from '@omniviewdev/ui/layout';

// project-imports
import MetadataSection from "./sections/MetadataSection";
import { KubernetesResourceObject } from "../../../../../types/resource";

interface Props {
  data: KubernetesResourceObject;
  children?: React.ReactNode;
}

export const BaseOverviewPage: React.FC<Props> = ({ data, children }) => {
  if (!data) {
    console.log("did not get any data")
    return <React.Fragment />;
  }

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <MetadataSection data={data.metadata} />
      {children}
    </Stack>
  );
};

BaseOverviewPage.displayName = "BaseOverviewPage";
export default BaseOverviewPage;
