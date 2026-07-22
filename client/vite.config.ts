import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  const apiPort = process.env.SERVER_PORT || process.env.PORT || "3001";
  const target = `http://localhost:${apiPort}`;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": target,
        "/socket.io": {
          target,
          ws: true
        }
      }
    }
  };
});
