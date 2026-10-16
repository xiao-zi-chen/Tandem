import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/.tandem/**', '**/.tandem-*/**', '**/research/**', '**/test-results/**'],
    },
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        '**/.tandem/**',
        '**/.tandem-*/**',
        '**/research/**',
      ],
    },
  },
  build: { outDir: 'dist/client', sourcemap: true },
});
