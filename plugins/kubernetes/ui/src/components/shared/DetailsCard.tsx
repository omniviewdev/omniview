import React from "react";

// material-ui
import {
  Avatar,
  Card,
  CardContent,
  CardOverflow,
  Divider,
  Grid,
  Stack,
  Typography,
} from '@mui/joy';

// project imports
import Icon from "./Icon";

export interface DetailsCardEntry {
  key: string;
  value: string;
  icon?: string | React.ReactNode;
  ratio?: [number, number];
  used?: string;
  defaultValue?: string;
  endAdornment?: React.ReactNode;
  startAdornment?: React.ReactNode;
}

export interface DetailsCardProps {
  title?: string;
  titleSize?: "sm" | "md" | "lg";
  icon?: string | React.ReactNode;
  data: DetailsCardEntry[];
  endAdornment?: React.ReactNode;
  /** Show the kv pair even if the value is undefined */
  showUndefined?: boolean;
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
export const DetailsCard: React.FC<DetailsCardProps> = ({
  title,
  titleSize = "md",
  icon,
  data,
  endAdornment,
  showUndefined = false,
}) => {
  return (
    <Card
      variant="outlined"
      sx={{
        p: 1,
        gap: getTitleContainerSpacing(titleSize),
        bgcolor: 'background.level1'
      }}
    >
      {title && (
        <CardOverflow sx={{ p: 1, display: 'flex', flexDirection: 'row', justifyContent: 'space-between', bgcolor: 'background.surface', borderBottom: '1px solid divider' }}>
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
          {endAdornment}
          <Divider />
        </CardOverflow>
      )}
      <CardContent>
        <Grid
          container
          spacing={1}
        >
          {data.map((entry) => {
            if (entry.value || showUndefined) {
              return (
                <React.Fragment key={entry.key}>
                  <Grid xs={entry.ratio?.[0] ?? 5}>
                    <Stack direction="row" spacing={1} alignItems={"center"}>
                      {entry.icon &&
                        (typeof entry.icon === "string" ? (
                          entry.icon.startsWith("http") ? (
                            <Avatar src={entry.icon} size="sm" />
                          ) : (
                            <Icon name={entry.icon} size={14} />
                          )
                        ) : (
                          icon
                        ))}
                      <Typography level="body-xs">{entry.key}</Typography>
                    </Stack>
                  </Grid>
                  <Grid xs={entry.ratio?.[1] ?? 7}>
                    <Stack direction="row" spacing={1} alignItems={"center"} justifyContent={'space-between'}>
                      <Typography
                        textColor={"neutral.200"}
                        level="body-xs"
                        noWrap
                      >
                        {entry.used
                          ? `${entry.used} / ${entry.value}`
                          : entry.value}
                      </Typography>
                      {entry.endAdornment}
                    </Stack>
                  </Grid>
                </React.Fragment>
              );
            }
          })}
        </Grid>
      </CardContent>
    </Card>
  );
};

DetailsCard.displayName = "DetailsCard";

export default DetailsCard;
