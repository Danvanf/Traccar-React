import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const traccarTarget = process.env.VITE_TRACCAR_TARGET || 'http://192.168.16.16:8082'
const traccarScopeApiTarget = process.env.VITE_TRACCAR_SCOPE_API_TARGET || 'http://localhost:5124'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5510,
    strictPort: true,
    proxy: {
      '/api': {
        target: traccarTarget,
        changeOrigin: true,
        secure: false,
      },
      '/traccar-scope-api': {
        target: traccarScopeApiTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/traccar-scope-api/, ''),
      },
    },
  },
})
