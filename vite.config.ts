/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // @mediapipe/pose is imported by pose-detection but unused with MoveNet
      external: ['@mediapipe/pose'],
    },
  },
  optimizeDeps: {
    exclude: ['@mediapipe/pose'],
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
