import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The API routes live on the uvicorn server. In dev, Vite proxies them so the React app on
// :5173 talks to FastAPI on :3000; in production `npm run build` emits dist/ and uvicorn
// serves it directly, so the same paths work with no proxy.
const API = ['/extract', '/clean', '/agent', '/brief', '/commit'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API.map((p) => [p, { target: 'http://127.0.0.1:3000', changeOrigin: true }]),
    ),
  },
});
