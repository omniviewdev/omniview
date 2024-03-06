import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
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
  },
  plugins: [
    react({
      jsxImportSource: '@welldone-software/why-did-you-render',
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
