import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { omniviewExternals } from "@omniviewdev/vite-plugin";

const external = [
  // MUI
  "@emotion/react",
  "@emotion/styled",
  "@mui/base",
  '@mui/base/Unstable_Popup',
  "@mui/joy",
  '@mui/joy/Table',
  '@mui/joy/Typography',
  '@mui/joy/Sheet',
  '@mui/joy/Stack',
  '@mui/joy/Box',
  '@mui/joy/Card',
  '@mui/joy/CardContent',
  '@mui/joy/Divider',
  '@mui/joy/Grid',
  '@mui/joy/AccordionGroup',
  '@mui/joy/Accordion',
  '@mui/joy/AccordionDetails',
  '@mui/joy/AccordionSummary',
  '@mui/joy/Avatar',
  '@mui/joy/Chip',
  '@mui/joy/Tooltip',
  '@mui/joy/Button',
  '@mui/joy/FormControl',
  '@mui/joy/FormHelperText',
  '@mui/joy/IconButton',
  '@mui/joy/Input',
  '@mui/joy/Textarea',
  '@mui/joy/Alert',
  '@mui/joy/Link',
  '@mui/joy/Select',
  '@mui/joy/Option',
  '@mui/joy/List',
  '@mui/joy/ListItem',
  '@mui/joy/ListItemButton',
  '@mui/joy/ListItemContent',
  '@mui/joy/ListItemDecorator',
  '@mui/joy/ListSubheader',
  '@mui/joy/Badge',
  '@mui/joy/Modal',
  '@mui/joy/ModalClose',
  '@mui/joy/ModalDialog',
  '@mui/joy/Drawer',
  '@mui/joy/DialogTitle',
  '@mui/joy/DialogContent',
  '@mui/joy/Checkbox',
  '@mui/joy/Menu',
  '@mui/joy/MenuButton',
  '@mui/joy/MenuItem',
  '@mui/joy/Dropdown',
  '@mui/joy/Snackbar',
  '@mui/joy/CircularProgress',
  '@mui/joy/LinearProgress',
  '@mui/joy/Tab',
  '@mui/joy/TabList',
  '@mui/joy/Tabs',
  '@mui/joy/TabPanel',
  '@mui/joy/styled',
  "@mui/icons-material",
  "date-fns",

  // REACT
  "react",
  "react/jsx-runtime",
  "react-router-dom",
  "react-dom",
  "react-icons",
  "@tanstack/react-query",
  '@tanstack/react-table',
  '@tanstack/react-virtual',

  // Monaco
  "@monaco-editor/react",
  "monaco-editor",
  "monaco-yaml",
  "yaml",

  // OMNIVIEW
  "@omniviewdev/runtime",
  "@omniviewdev/runtime/api",
  "@omniviewdev/runtime/models",
  "@omniviewdev/runtime/runtime",
];

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    omniviewExternals(),
  ],
  server: {
    host: '127.0.0.1',
    cors: true,
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
    },
  },
  build: {
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      input: "src/entry.ts",
      output: {
        entryFileNames: "assets/entry.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
        format: 'system',
      },
      preserveEntrySignatures: 'exports-only',
      external,
    }
  },
});
