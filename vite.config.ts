import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages menyajikan repo di /<nama-repo>/. Bisa dioverride lewat BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/Subscription-dashboard/',
  plugins: [react()],
});
