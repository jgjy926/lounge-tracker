import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A relative base serves the same build from GitHub Pages (/<repo>/) and from
// the Capacitor WebView (https://localhost/). Navigation is hash-based.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || 'dev'),
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
