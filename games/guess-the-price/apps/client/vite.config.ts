import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	base: process.env.VITE_BASE_PATH || '/price-guess/',
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
	preview: {
		port: 8088,
		host: true,
		strictPort: true
	},
	server: {
		port: 8088,
		strictPort: true,
		host: true,
		origin: "http://0.0.0.0:8088"
	}
});
