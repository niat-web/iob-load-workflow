import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxy = {
  "/api": {
    target: "http://localhost:8000",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rolldownOptions: {
      input: { main: "index.html", redirect: "redirect.html" },
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 20 },
            { name: "query", test: /node_modules[\\/]@tanstack[\\/](query-core|react-query)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
