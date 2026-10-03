import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./pwa.ts";

export default defineConfig({
  plugins: [react(), VitePWA(pwaOptions)],
  // localhost:5173 is the origin the local API allows (Supabase auth site_url, ALLOWED_ORIGINS).
  server: { host: "localhost", port: 5173, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
