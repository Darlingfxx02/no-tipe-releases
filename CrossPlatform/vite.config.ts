import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: {
    target: ['es2022', 'safari15'],
    sourcemap: false,
    minify: 'oxc',
    rolldownOptions: { input: { main: 'index.html', notch: 'notch.html' } },
  },
});
