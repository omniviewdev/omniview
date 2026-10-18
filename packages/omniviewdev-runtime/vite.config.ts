/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";
import react from "@vitejs/plugin-react";

import { fileURLToPath } from 'url';
import { dirname } from 'path';

// if in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputDirectory = process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY || 'dist';

const externals = [
  // REACT
  "react",
  "react/jsx-runtime",
  "react-router-dom",
  "react-dom",
  "react-icons",
  "@tanstack/react-query",

  // OMNIVIEW
  "@omniviewdev/base-ui",
]

// https://vitejs.dev/config/
export default defineConfig({
  cacheDir: process.env.OMNIVIEW_VITE_CACHE_DIRECTORY,
  build: {
    outDir: outputDirectory,
    lib: {
      entry: [
        resolve(__dirname, "src/index.ts"),
        resolve(__dirname, "src/api.ts"),
        resolve(__dirname, "src/models.ts"),
        resolve(__dirname, "src/runtime.ts"),
      ],
      name: "@omniview/runtime",
    },
    rollupOptions: {
      external: externals,
      output: {
        globals: {
          'react': 'react',
          'react-dom': 'ReactDOM',
          'react-router-dom': 'ReactRouterDOM',
          'react/jsx-runtime': 'react/jsx-runtime',
        },
      },
    }
  },
  plugins: [
    react(),
    dts({ tsconfigPath: './tsconfig.app.json', outDir: outputDirectory })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
