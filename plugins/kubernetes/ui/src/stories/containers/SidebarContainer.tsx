import { type FC } from "react";

// Material-ui
import Chip from "@mui/joy/Chip";
import DialogContent from "@mui/joy/DialogContent";
import Sheet from "@mui/joy/Sheet";
import Stack from "@mui/joy/Stack";
import DynamicIcon from "../components/DynamicIcon";
import { Divider, IconButton, Typography } from "@mui/joy";
import { LuX } from "react-icons/lu";

type Props = {
  icon?: string | React.ReactNode;
  type: string;
  title: string;
  decorator?: string | React.ReactNode;
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
};

type JSONValue = string | number | boolean | JSONObject | JSONArray;

interface JSONObject {
  [x: string]: JSONValue;
}

interface JSONArray extends Array<JSONValue> {}

const ResourceDrawerDecorator: FC<{
  icon: string | React.ReactNode;
  type: string;
}> = ({ icon, type }) => {
  return (
    <Chip
      size="lg"
      variant="soft"
      sx={{ borderRadius: "sm" }}
      startDecorator={
        typeof icon === "string" ? <DynamicIcon name={icon} size={16} /> : icon
      }
    >
      <Typography level="title-sm">{type}</Typography>
    </Chip>
  );
};

const ResourceDrawerContainer: FC<Props> = ({
  icon,
  type,
  title,
  children,
}) => (
  <Sheet
    sx={{
      borderRadius: "md",
      p: 1,
      display: "flex",
      flexDirection: "column",
      gap: 1,
      maxHeight: "calc(100vh - 64px)",
      minHeight: "calc(100vh - 64px)",
      overflow: "auto",
    }}
  >
    <Stack direction="row" alignItems="center" justifyContent={"space-between"}>
      <Chip size="lg" variant="plain" sx={{ borderRadius: "sm" }}>
        <Typography sx={{ flexGrow: 1 }}>{title}</Typography>
      </Chip>
      <Stack direction="row" gap={1}>
        <ResourceDrawerDecorator icon={icon ?? "LuBox"} type={type} />
        <IconButton variant="outlined" size="sm" onClick={() => {}}>
          <LuX size={20} />
        </IconButton>
      </Stack>
    </Stack>
    <Divider />
    <DialogContent
      sx={{
        gap: 2,
        p: 0.5,
        overflowY: "auto",
        maxWidth: "100%",
        overflowX: "hidden",
        scrollbarWidth: "none",
        // hide scrollbar
        "&::-webkit-scrollbar": {
          display: "none",
        },
        "ms-overflow-style": "none",
      }}
    >
      {children}
    </DialogContent>
  </Sheet>
);

export default ResourceDrawerContainer;
