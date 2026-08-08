import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { swPrecacheManifest } from "./plugins/sw-precache-manifest";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const backendPort = env.PORT || 5001;
  const frontendPort = Number(env.VITE_DEV_PORT || env.FRONTEND_PORT || 5173);

  return {
    envDir: path.resolve(__dirname, ".."),
    plugins: [
      react(),
      tailwindcss(),
      swPrecacheManifest(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: frontendPort,
      allowedHosts: true,
      hmr: {
        // Tailscale Serve terminates TLS and proxies to this port
        clientPort: frontendPort,
      },
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req) => {
              const host = req.headers.host;
              if (host) {
                proxyReq.setHeader("x-forwarded-host", host);
              }
              const proto = req.headers["x-forwarded-proto"] || "https";
              proxyReq.setHeader("x-forwarded-proto", String(proto));
              // Preserve browser Origin for WebAuthn expectedOrigin checks
              if (req.headers.origin) {
                proxyReq.setHeader("origin", String(req.headers.origin));
              }
            });
          },
        },
      },
    },
    build: {
      assetsInlineLimit: 4096,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
        },
        output: {
          entryFileNames: "assets/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            if (assetInfo.name === "manifest.json") {
              return "manifest.json";
            }
            return "assets/[name]-[hash][extname]";
          },
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 5173,
    },
    worker: {
      rollupOptions: {
        output: {
          entryFileNames: "sw.js",
        },
      },
    },
  };
});
