import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const kit = fileURLToPath(new URL('../../../packages/boardgame-kit/src', import.meta.url));
// Lokaler Monopoly-Server für `npm run dev` (Assets, API und WebSocket kommen von dort)
const backend = process.env.MONOPOLY_BACKEND || 'http://127.0.0.1:8090';

export default defineConfig({
    // Relativ, weil die Seite unter /monopoly/ (Hub) und unter / (direkt) läuft
    base: './',
    publicDir: false,
    resolve: { alias: { '@treffen/boardgame-kit': kit } },
    build: {
        outDir: '../static/dist',
        emptyOutDir: true,
        sourcemap: true,
        chunkSizeWarningLimit: 1500
    },
    server: {
        fs: { allow: ['..', kit] },
        proxy: {
            '/ws': { target: backend, ws: true },
            '/api': backend,
            '/static': backend
        }
    }
});
