import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        docs: fileURLToPath(new URL('./index.html', import.meta.url)),
        frame: fileURLToPath(new URL('./frame.html', import.meta.url)),
      },
    },
  },
});
