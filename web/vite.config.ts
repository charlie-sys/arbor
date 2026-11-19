import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = (value: string): string => fileURLToPath(new URL(value, import.meta.url))

export default defineConfig({
  root: here('.'),
  base: '/',
  publicDir: here('../src/renderer/public'),
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/v1': {
        target: process.env.ARBOR_DEV_API_TARGET ?? 'http://127.0.0.1:4318',
        changeOrigin: true
      }
    }
  },
  resolve: {
    alias: {
      '@shared': here('../src/shared'),
      '@renderer': here('../src/renderer/src')
    }
  },
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: here('index.html'),
        blindBox: here('blind-box.html')
      }
    }
  }
})
