import React from "react";

// material-ui
import Chip from "@mui/joy/Chip";
import Stack from "@mui/joy/Stack";

// types
import { Secret } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../shared/ObjectMetaSection";
import { LuKey } from "react-icons/lu";
import { Grid, Input, Typography } from "@mui/joy";

interface Props {
  data: object;
}

/**
 * Renders a sidebar for a ConfigMap resource
 */
export const SecretSidebar: React.FC<Props> = ({ data }) => {
  // assert this is a ConfigMap
  const secret = data as Secret;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={secret.metadata} />

      <div>
        <Chip
          sx={{ borderRadius: "sm" }}
          size="lg"
          variant="soft"
          startDecorator={<LuKey />}
        >
          Secrets
        </Chip>
        {secret.data !== undefined && (
          <Grid container spacing={0.5} padding={1}>
            {Object.entries(secret.data).map(([key, value]) => (
              <>
                <Grid
                  xs={6}
                  key={key}
                  sx={{ alignItems: "center", alignContent: "center" }}
                >
                  <Typography level="body-sm" fontFamily="monospace">
                    {key}
                  </Typography>
                </Grid>
                <Grid xs={6}>
                  <Input size="sm" value={atob(value)} />
                </Grid>
              </>
            ))}
          </Grid>
        )}
      </div>
    </Stack>
  );
};

SecretSidebar.displayName = "SecretSidebar";
export default SecretSidebar;
