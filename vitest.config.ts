import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], test: { environment: 'node', include: ['tests/**/*.test.ts','tests/**/*.test.tsx'], exclude: ['tests/e2e/**','node_modules/**'], testTimeout: 20000, hookTimeout: 20000, fileParallelism: false, maxWorkers: 1, restoreMocks: true, clearMocks: true } });
