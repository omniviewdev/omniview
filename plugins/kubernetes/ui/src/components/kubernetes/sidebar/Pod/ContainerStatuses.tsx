import React from "react";

// material ui
import { Chip } from "@omniviewdev/ui";
import Grid from "@mui/material/Grid";
import { Tooltip } from "@omniviewdev/ui/overlays";
import { Text } from "@omniviewdev/ui/typography";

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
            <Grid size={6}>
              <Text size="xs">{key}</Text>
            </Grid>
            <Grid size={6}>
              <Text size="xs">{value}</Text>
            </Grid>
          </React.Fragment>
        ) : null,
      )}
      {state.message && (
        <Grid size={12}>
          <Text size="xs">{state.message}</Text>
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
              <Grid size={6}>
                <Text size="xs">{key}</Text>
              </Grid>
              <Grid size={6}>
                <Text size="xs">{value}</Text>
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
        return "outline";
      case "Waiting":
        return "soft";
      default:
        return "solid";
    }
  };

  return (
    <Tooltip
      key={statusInfo.text}
      placement="top-end"
      content={<ContainerStatusCard status={status} />}
    >
      <Chip
        size="sm"
        sx={{
          borderRadius: "sm",
          px: 1,
        }}
        color={statusInfo.color}
        emphasis={getVariant()}
        startAdornment={
          statusInfo.icon && <Icon name={statusInfo.icon} size={16} />
        }
        label={statusInfo.text}
      />
    </Tooltip>
  );
};
