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
        // 127.0.0.1, not localhost. macOS resolves "localhost" to ::1
        // first; the backend listens on IPv4 (0.0.0.0:8001) so every
        // connect tries IPv6, fails, and retries on IPv4 — extra
        // latency + an abandoned socket per request. Pinning the
        // target to 127.0.0.1 skips that round-trip entirely.
        target: process.env.BACKEND_URL ?? "http://127.0.0.1:8001",
        changeOrigin: true,
        agent: keepAliveAgent,
      },
    },
  },
});
