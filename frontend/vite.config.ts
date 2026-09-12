import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), basicSsl(), tailwindcss()],
  server: {
    host: "localhost",
    port: 5173,
    proxy: {
      // Forwards to the FastAPI backend during local dev (npm run dev).
      // In production, set VITE_API_BASE to your deployed backend URL instead.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
