import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const backendPort = env.PORT || 5001;
  const authUsername = env.AUTH_USERNAME;
  const authPassword = env.AUTH_PASSWORD;
  
  const proxyHeaders = authUsername && authPassword 
    ? { headers: { Authorization: `Basic ${Buffer.from(`${authUsername}:${authPassword}`).toString('base64')}` } }
    : {};

  return {
    envDir: path.resolve(__dirname, ".."),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts: true,
      proxy: {
        "/api/terminal/socket.io": {
          target: `http://127.0.0.1:${backendPort}`,
          ws: true,
          changeOrigin: true,
          ...proxyHeaders,
        },
        "/api": {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
          ...proxyHeaders,
        },
      },
    },
    build: {
      assetsInlineLimit: 4096,
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo) => {
            if (assetInfo.name === "manifest.json") {
              return "manifest.json";
            }
            return "assets/[name]-[hash][extname]";
          },
        },
      },
    },
  };
});
