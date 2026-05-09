import http from "node:http";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Re-use sockets for proxied /api calls. Without this Vite opens a
// fresh TCP connection for every backend request, which on macOS
// quickly fills the ephemeral-port range with TIME_WAIT entries
// (each lingers ~60 s). Symptoms the user kept hitting: tags pane
// "loads forever" after a few page navigations, sporadic 5 s API
// timeouts, `netstat` showing thousands of TIME_WAITs on :8001.
const keepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

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
        agent: keepAliveAgent,
      },
    },
  },
});
