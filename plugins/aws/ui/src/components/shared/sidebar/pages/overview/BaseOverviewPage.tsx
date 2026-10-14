import React from "react";
import { Stack } from '@omniviewdev/base-ui';
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
    <Stack direction="column" spacing={2} style={{ width: "100%" }}>
      <MetadataSection data={data} />
      {children}
    </Stack>
  );
};

BaseOverviewPage.displayName = "BaseOverviewPage";
export default BaseOverviewPage;
