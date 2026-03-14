/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @mediapipe/pose is imported by pose-detection but unused with MoveNet.
      // Stub it to avoid import errors in both dev and build.
      '@mediapipe/pose': path.resolve(__dirname, 'src/stubs/mediapipe-pose.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
