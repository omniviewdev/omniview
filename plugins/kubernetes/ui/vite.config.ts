import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const external = [
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
]

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
  server: {
    port: 15173,
    cors: true,
    origin: "http://localhost:15173",
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 15173,
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
      },      // Keep exports as defined in source
      preserveEntrySignatures: 'exports-only',
      external,
      // external: (id) => {
      //   const match = external.some(pkg => id === pkg || id.startsWith(pkg))
      //   if (match) console.log(`EXTERNAL: ${id}`)
      //   return match
      // }
    }
  },
});

