import React from "react";

// material-ui
import Chip from "@mui/joy/Chip";
import Stack from "@mui/joy/Stack";

// types
import { ConfigMap } from "kubernetes-types/core/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ExpandableSections from "../../shared/ExpandableSections";
import CodeEditor from "../../shared/CodeEditor";
import ObjectMetaSection from "../../shared/ObjectMetaSection";
import { LuCode } from "react-icons/lu";

interface Props {
  ctx: DrawerContext<ConfigMap>;
}

/**
 * Renders a sidebar for a ConfigMap resource
 */
export const ConfigMapSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const configMap = ctx.data;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={configMap.metadata} />

      <div>
        <Chip
          sx={{ borderRadius: "sm", mb: 1 }}
          size="md"
          variant="soft"
          startDecorator={<LuCode />}
        >
          Configs
        </Chip>
        {configMap.data !== undefined && (
          <ExpandableSections
            sections={Object.entries(configMap.data).map(
              ([key, value], idx) => ({
                title: key,
                icon: "LuFile",
                defaultExpanded: idx === 0,
                children: (
                  <CodeEditor
                    value={value}
                    height="40vh"
                    filename={`${configMap.metadata?.uid}/${key}`}
                    readOnly={true}
                  />
                ),
              }),
            )}
          />
        )}
      </div>
    </Stack>
  );
};

ConfigMapSidebar.displayName = "ConfigMapSidebar";
export default ConfigMapSidebar;
