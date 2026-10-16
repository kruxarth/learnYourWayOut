import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node', testTimeout: 30_000, include: ['src/tests/**/*.test.ts', 'server/**/*.test.ts'] },
  // in dev, the game server (npm run server) answers /api and the multiplayer socket /ws
  server: { proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
})
