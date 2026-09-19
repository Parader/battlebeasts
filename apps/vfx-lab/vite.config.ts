import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;
const pkg = (name: string) => path.resolve(root, `node_modules/${name}`);

export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(root, "../web/public"),
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      "@web": path.resolve(root, "../web/src"),
      // @web sources sit under apps/web; pin this app's R3F so VFX useFrame
      // shares the Canvas store. Do not alias `three` — that skips its
      // package exports (`three/addons/...`).
      "@react-three/fiber": pkg("@react-three/fiber"),
      "@react-three/drei": pkg("@react-three/drei"),
      "@react-three/postprocessing": pkg("@react-three/postprocessing"),
    },
    dedupe: [
      "react",
      "react-dom",
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/postprocessing",
    ],
  },
  server: {
    port: 5184,
    host: true,
    watch: {
      ignored: [
        "**/packages/shared/src/maps/*.map.json",
        "**/packages/shared/src/maps/authored.generated.ts",
        "**/apps/web/src/**",
        "**/apps/web/public/**",
        "**/apps/game-server/**",
      ],
    },
  },
});
