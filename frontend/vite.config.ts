import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// В разработке /api проксируется на локальный FastAPI.
// В сборке фронт лежит в frontend/dist и отдаётся тем же FastAPI — один URL стенда.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_TARGET || 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
})
