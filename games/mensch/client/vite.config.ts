import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const pkg = (p: string) => fileURLToPath(new URL(`../../../packages/${p}`, import.meta.url));
const backend = process.env.MENSCH_BACKEND || 'http://127.0.0.1:8095';

export default defineConfig({
    base: './',
    publicDir: false,
    resolve: {
        alias: {
            '@treffen/boardgame-kit': pkg('boardgame-kit/src'),
            '@treffen/tabletop': pkg('tabletop/src')
        },
        // three aus node_modules dieses Projekts – auch für Importe aus packages/
        dedupe: ['three']
    },
    build: { outDir: '../static3d', emptyOutDir: true, sourcemap: true, chunkSizeWarningLimit: 1500 },
    server: {
        fs: { allow: ['..', pkg('')] },
        proxy: { '/ws': { target: backend, ws: true }, '/api': backend }
    }
});
