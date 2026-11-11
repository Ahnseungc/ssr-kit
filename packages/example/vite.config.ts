import legacy from '@vitejs/plugin-legacy';
import react from '@vitejs/plugin-react';
import { ssrKit } from 'ssr-kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    legacy({ targets: ['chrome >= 49', 'android >= 5'] }),
    ssrKit({ routes: './src/routes.ts', document: './src/Document.tsx', routesDts: true }),
  ],
});
