import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], server: { port: 5173, proxy: { '/api': { target: process.env.TWIN_API_URL ?? 'http://127.0.0.1:8000', changeOrigin: true }, '/ws': { target: (process.env.TWIN_API_URL ?? 'http://127.0.0.1:8000').replace(/^http/, 'ws'), ws: true } } } });
