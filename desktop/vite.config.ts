import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port. The app is rendered in a WebView and all
// network access goes through Rust commands, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Cargo keeps target/ files locked on Windows; watching them crashes Vite.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2021",
    sourcemap: false,
  },
});
