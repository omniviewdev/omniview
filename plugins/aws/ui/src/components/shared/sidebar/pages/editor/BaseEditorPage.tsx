import React from "react";
import CodeEditor from "../../../../shared/CodeEditor";
import { Stack } from "@mui/joy";
import { stringify } from 'yaml'

interface Props {
  data?: Record<string, any>;
  children?: React.ReactNode;
}

export const BaseEditorPage: React.FC<Props> = ({ data }) => {
  const value = React.useMemo(() => stringify(data), [data])

  if (!data) {
    return <React.Fragment />;
  }

  return (
    <Stack flex={1} gap={1} direction={'column'}>
      <CodeEditor
        value={value}
        language="yaml"
        filename="resource.yaml"
        readOnly
      />
    </Stack>
  );
};

BaseEditorPage.displayName = "BaseEditorPage";
export default BaseEditorPage;
