import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ["localhost", "host.docker.internal", ".local"],
    proxy: {
      "/api": {
        target: process.env.BACKEND_URL ?? "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
});
