import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { omniviewExternals } from "@omniviewdev/vite-plugin";

const external = [
  // DND Kit
  "@dnd-kit/core",
  "@dnd-kit/modifiers",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",

  // MUI
  "@emotion/react",
  "@emotion/styled",
  "@mui/base",
  '@mui/base/Unstable_Popup',
  "@mui/x-charts",
  "@mui/material",
  "@mui/material-icons",
  "@mui/material-icons/si",
  "@mui/material-icons/lu",
  "date-fns",

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
    port: 15173,
    cors: true,
    strictPort: false,
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
