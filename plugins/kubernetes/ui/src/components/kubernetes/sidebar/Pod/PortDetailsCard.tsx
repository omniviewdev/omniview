import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";
import Card from "@mui/joy/Card";
import CardContent from "@mui/joy/CardContent";
import Avatar from "@mui/joy/Avatar";
import Divider from "@mui/joy/Divider";
import Grid from "@mui/joy/Grid";
import Typography from "@mui/joy/Typography";

// project imports
import Icon from "../../../shared/Icon";
import { Button, Chip, Tooltip } from "@mui/joy";
import { useResourcePortForwarder } from "@omniviewdev/runtime";
import { BrowserOpenURL } from "@omniviewdev/runtime/runtime";
import { networker } from "@omniviewdev/runtime/models";
import { ContainerPort } from "kubernetes-types/core/v1";

export interface DetailsCardProps {
  title?: string;
  titleSize?: "sm" | "md" | "lg";
  icon?: string | React.ReactNode;
  data: ContainerPort[];
  /** Show the kv pair even if the value is undefined */
  showUndefined?: boolean;
  resourceID: string;
  connectionID: string;
}

const getTitleFontSize = (size: "sm" | "md" | "lg") => {
  switch (size) {
    case "sm":
      return 12;
    case "md":
      return 14;
    case "lg":
      return 16;
    default:
      return 14;
  }
};

const getTitleContainerSpacing = (size: "sm" | "md" | "lg") => {
  switch (size) {
    case "sm":
      return 0.5;
    case "md":
      return 1;
    case "lg":
      return 2;
    default:
      return 1;
  }
};

const getTitleIconSize = (size: "sm" | "md" | "lg") => {
  switch (size) {
    case "sm":
      return 12;
    case "md":
      return 14;
    case "lg":
      return 16;
    default:
      return 14;
  }
};

/**
 * Renders a card for showing a key-value pairs of details
 */
export const PortDetailsCard: React.FC<DetailsCardProps> = ({
  resourceID,
  connectionID,
  title,
  titleSize = "md",
  icon,
  data,
}) => {
  const { sessions, forward, close } = useResourcePortForwarder({ pluginID: 'kubernetes', connectionID, resourceID })
  console.log(sessions.data)
  const portMap = sessions.data?.reduce((prev, curr) => {
    return { ...prev, [curr.remote_port]: curr }
  }, {} as Record<number, networker.PortForwardSession>) || {}

  const handleStartPortForward = (port: number, protocol: string = 'TCP') => {
    console.log('starting port forwarding session', { port, protocol })
    forward({
      opts: {
        resourceId: resourceID,
        resourceKey: 'core::v1::Pod',
        resource: {
          metadata: {
            name: resourceID,
            namespace: 'default',
          }
        },
        remotePort: port,
        openInBrowser: true,
        parameters: {}
      }
    })
  }

  const handleStopPortForward = (sessionID: string) => {
    console.log('stopping port forwarding session', { sessionID })
    close({ opts: { sessionID } })
  }

  return (
    <Card
      variant="outlined"
      sx={{ p: 1, gap: getTitleContainerSpacing(titleSize) }}
    >
      {title && (
        <>
          <Stack
            direction="row"
            spacing={getTitleContainerSpacing(titleSize)}
            alignItems={"center"}
          >
            {icon &&
              (typeof icon === "string" ? (
                icon.startsWith("http") ? (
                  <Avatar
                    src={icon}
                    size="sm"
                    sx={{ maxHeight: 16, maxWidth: 16, borderRadius: 4 }}
                  />
                ) : (
                  <Icon name={icon} size={getTitleIconSize(titleSize)} />
                )
              ) : (
                icon
              ))}
            <Typography fontSize={getTitleFontSize(titleSize)} level="title-sm">
              {title}
            </Typography>
          </Stack>
          <Divider />
        </>
      )}
      <CardContent>
        <Grid container spacing={0.5}>
          {data.map((entry) => {
            const existing = portMap[Number(entry.containerPort)]
            return (
              <React.Fragment key={entry.containerPort}>
                <Grid
                  sx={{
                    display: "flex",
                    alignItems: "center",
                  }}
                  xs={4}
                >
                  <Typography level="body-xs">{entry.name || entry.containerPort}</Typography>
                </Grid>

                <Grid xs={8}>
                  <Stack direction="row" spacing={1} justifyContent={"space-between"} alignItems={"center"}>
                    <Typography
                      textColor={"neutral.300"}
                      level="body-xs"
                      noWrap
                    >
                      {entry.containerPort}/{entry.protocol}
                    </Typography>
                    {!!existing &&
                      <Tooltip title={'Open in browser'} variant="outlined" size="sm">
                        <Chip
                          variant='soft'
                          sx={{ borderRadius: 'sm' }}
                          onClick={() => BrowserOpenURL(`http://localhost:${existing.local_port}`)}
                        >
                          {`http://localhost:${existing.local_port}`}
                        </Chip>
                      </Tooltip>
                    }
                    <Button
                      sx={{
                        py: 0,
                        px: 4,
                        minHeight: 28,
                      }}
                      color="primary"
                      variant="soft"
                      size="sm"
                      onClick={() => {
                        if (!existing) {
                          handleStartPortForward(Number(entry.containerPort), 'TCP')
                        } else {
                          handleStopPortForward(existing.id)
                        }
                      }}
                    >
                      <Typography fontSize={12}>
                        {!existing ? 'Forward' : 'Stop'}
                      </Typography>
                    </Button>
                  </Stack>
                </Grid>
              </React.Fragment>
            );
          })}
        </Grid>
      </CardContent>
    </Card>
  );
};

PortDetailsCard.displayName = "PortDetailsCard";
export default PortDetailsCard;
