import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const externals = [
  // MUI
  "@emotion/react",
  "@mui/joy",
  "@mui/base",
  "@mui/x-charts",
  "@mui/material",
  "@mui/material-icons",

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
        globals: {
          'react': 'react',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'react/jsx-runtime',
        },
      },
      preserveEntrySignatures: "exports-only",
      external: externals,
    }
  },
});

