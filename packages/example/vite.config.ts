import react from '@vitejs/plugin-react';
import { ssrKit } from 'ssr-kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    ssrKit({ routes: './src/routes.ts', document: './src/Document.tsx', routesDts: true }),
  ],
});
