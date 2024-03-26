import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from "@originjs/vite-plugin-federation";
import topLevelAwait from "vite-plugin-top-level-await";

import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// if in ESM context
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/_/': {
        bypass: function () {
          // Return false to produce a 404 error for the request.
          return false;
        }
      },
    },
  },
  plugins: [
    react({
      jsxImportSource: '@welldone-software/why-did-you-render',
    }),
    federation({
      name: "omniview-host",
      // needs a placeholder to prevent "ReferenceError: __rf_placeholder__shareScope is not defined"
      remotes: { noopRemote: 'noopRemote.js' },
      shared: [
        'react',
        'react-dom', 
        '@mui/joy',
        '@emotion/react',
      ]
    }),
    // Webkit doesn't support top level await
    topLevelAwait({
      promiseExportName: "__tla",
      promiseImportName: i => `__tla_${i}`
    })
  ],
  resolve: {
    alias: {
      // prepare for eventual package splitting
      "@infraview": path.resolve(__dirname, "./src/pkg"),
      // core routes
      "@": path.resolve(__dirname, "./src"),
      "@api": path.resolve(__dirname, "./wailsjs/go"),
      "@runtime": path.resolve(__dirname, "./wailsjs/runtime"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
      "@layouts": path.resolve(__dirname, "./src/layouts"),
      "@pages": path.resolve(__dirname, "./src/pages"),
      "@theme": path.resolve(__dirname, "./src/theme"),
      "@types": path.resolve(__dirname, "./src/types"),
      "@utils": path.resolve(__dirname, "./src/utils"),
    }
  }
})
