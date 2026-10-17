import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const traccarTarget = process.env.VITE_TRACCAR_TARGET || 'http://192.168.16.16:8082'
const traccarReactApiTarget = process.env.VITE_TRACCAR_REACT_API_TARGET || 'http://localhost:5124'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: traccarTarget,
        changeOrigin: true,
        secure: false,
      },
      '/traccar-react-api': {
        target: traccarReactApiTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/traccar-react-api/, ''),
      },
    },
  },
})
