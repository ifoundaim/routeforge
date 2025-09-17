import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/agent': 'http://localhost:8000',
      '/r': 'http://localhost:8000'
    }
  }
})


