import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: { outDir: 'dist/client', emptyOutDir: true, sourcemap: false }, server: { host: '127.0.0.1', strictPort: true, fs: { strict: true, deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.private/**', '**/*service-account*.json', '**/*credentials*.json'] } }, resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } } });
