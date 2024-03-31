import React from "react";

// material ui
import Chip from "@mui/joy/Chip";
import Grid from "@mui/joy/Grid";
import Tooltip from "@mui/joy/Tooltip";
import Typopgraphy from "@mui/joy/Typography";

// project imports
import Icon from "../../../shared/Icon";
import { getStatus } from "./utils";

// types
import {
  ContainerStateTerminated,
  ContainerStateWaiting,
  ContainerStatus,
} from "kubernetes-types/core/v1";
import ContainerStatusCard from "./ContainerStatusCard";

// third party
import { formatRelative } from "date-fns";

/**
 * Details on a why a container was terminated
 */
export const ContainerTerminatedStatusInfo: React.FC<{
  state: ContainerStateTerminated;
}> = ({ state }) => {
  const info = {
    "Exit Code": state.exitCode,
    Signal: state.signal,
    Reason: state.reason,
    Started: state.startedAt
      ? formatRelative(new Date(state.startedAt), new Date())
      : undefined,
    Finished: state.finishedAt
      ? formatRelative(new Date(state.finishedAt), new Date())
      : undefined,
  };

  return (
    <Grid container spacing={0}>
      {Object.entries(info).map(([key, value]) =>
        value ? (
          <React.Fragment key={key}>
            <Grid xs={6}>
              <Typopgraphy level="body-xs">{key}</Typopgraphy>
            </Grid>
            <Grid xs={6}>
              <Typopgraphy level="body-xs">{value}</Typopgraphy>
            </Grid>
          </React.Fragment>
        ) : null,
      )}
      {state.message && (
        <Grid xs={12}>
          <Typopgraphy level="body-xs">{state.message}</Typopgraphy>
        </Grid>
      )}
    </Grid>
  );
};

/**
 * Details on why a container is waiting
 */
export const ContainerWaitingStatusInfo: React.FC<{
  state: ContainerStateWaiting;
}> = ({ state }) => {
  const info = {
    Reason: state.reason,
    Message: state.message,
  };

  return (
    <Grid container spacing={0}>
      {Object.entries(info).map(
        ([key, value]) =>
          value && (
            <React.Fragment key={key}>
              <Grid xs={6}>
                <Typopgraphy level="body-xs">{key}</Typopgraphy>
              </Grid>
              <Grid xs={6}>
                <Typopgraphy level="body-xs">{value}</Typopgraphy>
              </Grid>
            </React.Fragment>
          ),
      )}
    </Grid>
  );
};

export const ContainerStatusDecorator: React.FC<{
  status: ContainerStatus;
}> = ({ status }) => {
  const statusInfo = getStatus(status);

  const getVariant = () => {
    switch (statusInfo.text) {
      case "Completed":
        return "outlined";
      case "Waiting":
        return "soft";
      default:
        return "solid";
    }
  };

  return (
    <Tooltip
      placement="top-end"
      variant="soft"
      sx={{
        border: (theme) => `1px solid ${theme.palette.divider}`,
      }}
      title={<ContainerStatusCard status={status} />}
    >
      <Chip
        size="sm"
        sx={{
          borderRadius: "sm",
          px: 1,
        }}
        color={statusInfo.color}
        variant={getVariant()}
        startDecorator={
          statusInfo.icon && <Icon name={statusInfo.icon} size={16} />
        }
      >
        {statusInfo.text}
      </Chip>
    </Tooltip>
  );
};
