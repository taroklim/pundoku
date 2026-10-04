import { mergeConfig } from "vite";
import base from "./vite.config";
export default mergeConfig(base, {
  preview: { port: 5997, strictPort: true, proxy: { "/api": { target: "http://localhost:3997", changeOrigin: true } } },
  server: { port: 5997, strictPort: true, proxy: { "/api": { target: "http://localhost:3997", changeOrigin: true } } },
});
