import { type FC } from "react";

// Material-ui
import DialogTitle from "@mui/joy/DialogTitle";
import DialogContent from "@mui/joy/DialogContent";
import ModalClose from "@mui/joy/ModalClose";
import Sheet from "@mui/joy/Sheet";

type Props = {
  title: string;
  open: boolean;
  onClose: () => void;
  resource?: Record<string, unknown>;
  children?: React.ReactNode;
};

const ResourceDrawerContainer: FC<Props> = ({ title, children }) => (
  <Sheet
    sx={{
      borderRadius: "md",
      p: 2,
      display: "flex",
      flexDirection: "column",
      gap: 2,
      maxHeight: "calc(100vh - 64px)",
      overflow: "auto",
    }}
  >
    <DialogTitle>{title}</DialogTitle>
    <ModalClose />
    <DialogContent
      sx={{
        gap: 2,
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
