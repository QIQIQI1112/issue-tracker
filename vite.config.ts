import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.API_PORT ?? 4310);
const uiPort = Number(process.env.UI_PORT ?? 5173);
export default defineConfig({
  plugins: [react()],
  cacheDir: `.runs/vite/${uiPort}`,
  server: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
});
