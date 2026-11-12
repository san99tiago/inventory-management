import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // 2026-11-12: GitHub Pages serves the project under /inventory-management/, so the
  // Pages workflow sets VITE_BASE_PATH. Local development keeps the default '/'.
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    port: 3000
  }
})
