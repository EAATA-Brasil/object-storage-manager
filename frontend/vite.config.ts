import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ["2yx4m1a3.eaata.pro"],
    watch: {
      usePolling: true,
    },
  },
})
