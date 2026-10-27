import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Renderer is loaded from the dev server in `npm run dev`, and from dist/index.html
// by Electron in production, so asset paths must be relative.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
