import React from "react";
import { Stack } from "@omniviewdev/ui/layout";
import MetadataSection from "./sections/MetadataSection";

interface Props {
  data: Record<string, any>;
  children?: React.ReactNode;
}

export const BaseOverviewPage: React.FC<Props> = ({ data, children }) => {
  if (!data) {
    return <React.Fragment />;
  }
  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <MetadataSection data={data} />
      {children}
    </Stack>
  );
};

BaseOverviewPage.displayName = "BaseOverviewPage";
export default BaseOverviewPage;
