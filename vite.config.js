import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const traccarTarget = process.env.VITE_TRACCAR_TARGET || 'http://192.168.16.16:8082'
const vehicleApiTarget = process.env.VITE_VEHICLE_API_TARGET || 'http://localhost:5124'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: traccarTarget,
        changeOrigin: true,
        secure: false,
      },
      '/vehicle-api': {
        target: vehicleApiTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/vehicle-api/, ''),
      },
    },
  },
})
