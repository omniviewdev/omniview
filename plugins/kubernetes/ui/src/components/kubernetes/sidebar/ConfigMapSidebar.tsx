import React from "react";

// material-ui
import Chip from "@mui/joy/Chip";
import Stack from "@mui/joy/Stack";

// types
import { ConfigMap } from "kubernetes-types/core/v1";

// project-imports
import ExpandableSections from "../../shared/ExpandableSections";
import CodeEditor from "../../shared/CodeEditor";
import ObjectMetaSection from "../../shared/ObjectMetaSection";
import { LuCode } from "react-icons/lu";

interface Props {
  data: object;
}

/**
 * Renders a sidebar for a ConfigMap resource
 */
export const ConfigMapSidebar: React.FC<Props> = ({ data }) => {
  // assert this is a ConfigMap
  const configMap = data as ConfigMap;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={configMap.metadata} />

      <div>
        <Chip
          sx={{ borderRadius: "sm", mb: 1 }}
          size="lg"
          variant="soft"
          startDecorator={<LuCode />}
        >
          Configs
        </Chip>
        {configMap.data !== undefined && (
          <ExpandableSections
            sections={Object.entries(configMap.data).map(([key, value]) => ({
              title: key,
              icon: "LuFile",
              defaultExpanded: true,
              children: (
                <CodeEditor value={value} language="yaml" readOnly={true} />
              ),
            }))}
          />
        )}
      </div>
    </Stack>
  );
};

ConfigMapSidebar.displayName = "ConfigMapSidebar";
export default ConfigMapSidebar;
