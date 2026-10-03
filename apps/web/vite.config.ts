import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // localhost:5173 is the origin the local API allows (Supabase auth site_url, ALLOWED_ORIGINS).
  server: { host: "localhost", port: 5173, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
