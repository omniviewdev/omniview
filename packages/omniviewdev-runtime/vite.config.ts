/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { resolve, sep } from "path";
import dts from "vite-plugin-dts";
import react from "@vitejs/plugin-react";

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { vitestCaches } from '../../vitest.cache';

// if in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputDirectory = process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY || 'dist';
const testCaches = vitestCaches(__dirname);

const externals = [
  // REACT
  "react",
  "react/jsx-runtime",
  "react/compiler-runtime",
  "react-router",
  "react-router/dom",
  "react-dom",
  "react-icons",
  "@tanstack/react-query",

  // OMNIVIEW
  "@omniviewdev/base-ui",
]

// https://vitejs.dev/config/
export default defineConfig({
  cacheDir: process.env.OMNIVIEW_VITE_CACHE_DIRECTORY ?? testCaches.cacheDir,
  build: {
    outDir: outputDirectory,
    lib: {
      // The object form names each output after its key: `ui/v1` writes `dist/ui/v1.js` (and `.cjs`), the path the package's `exports` map names.
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        api: resolve(__dirname, "src/api.ts"),
        models: resolve(__dirname, "src/models.ts"),
        runtime: resolve(__dirname, "src/runtime.ts"),
        "ui/v1": resolve(__dirname, "src/ui/v1.ts"),
      },
      name: "@omniview/runtime",
    },
    rollupOptions: {
      external: externals,
      output: {
        globals: {
          'react': 'react',
          'react-dom': 'ReactDOM',
          'react-router': 'ReactRouter',
          'react-router/dom': 'ReactRouterDOM',
          'react/jsx-runtime': 'react/jsx-runtime',
        },
      },
    }
  },
  plugins: [
    react({ babel: { plugins: [["babel-plugin-react-compiler", { target: "19" }]] } }),
    dts({
      tsconfigPath: './tsconfig.app.json',
      outDirs: outputDirectory,
      // The curated entry's declarations come from their own program (tsconfig.ui-v1.json, `dist/ui-v1/`): this program holds the main barrel, and an
      // inferred type in a declaration emitted from it would name the barrel (`import('../..')`) and so reach the previous UI library.
      beforeWriteFile: (filePath) => (filePath.split(sep).join("/").startsWith(`${resolve(__dirname, outputDirectory, "ui").split(sep).join("/")}/`) ? false : undefined),
    }),
  ],
  test: {
    fsModuleCachePath: testCaches.fsModuleCachePath,
    globals: true,
    environment: 'jsdom',
  },
});
