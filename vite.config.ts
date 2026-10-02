import { defineConfig } from 'vitest/config';
export default defineConfig({ base: './', server: { host: '127.0.0.1', strictPort: true }, test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'electron/**/*.test.ts'], exclude: ['node_modules', 'dist', 'dist-electron'] } });
