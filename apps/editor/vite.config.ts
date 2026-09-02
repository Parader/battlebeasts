import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { editorApi } from "./server/api";

export default defineConfig({
  plugins: [react(), editorApi()],
  /**
   * Serve the game's public directory directly, so prop URLs from the manifest
   * (`/assets/props/...`), the hero mesh used as a scale reference, and the
   * ground textures all resolve to the exact same paths the game uses.
   */
  publicDir: path.resolve(import.meta.dirname, "../web/public"),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      /**
       * Terrain rendering is shared with the game rather than reimplemented.
       * A map has to look the same here as it does in a match, and two copies
       * of a splat shader would drift the first time either is touched. The
       * dependency only points this way -- the game never imports the editor.
       */
      "@web": path.resolve(import.meta.dirname, "../web/src"),
    },
    dedupe: ["three"],
  },
  server: {
    port: 5183,
    host: true,
    /**
     * Do not reload the page when the editor writes a map.
     *
     * `authored.generated.ts` statically imports every `*.map.json`, and the
     * editor pulls in the shared package, so saved maps land inside its own
     * module graph. Saving therefore triggered a full reload, which resets the
     * document store to a blank map -- making New look like it had done
     * nothing when it had in fact just written the file.
     *
     * Nothing is lost by ignoring them: the editor reads maps over the API,
     * never as modules. Only the game needs the generated index, and it has
     * its own dev server.
     */
    watch: {
      ignored: [
        "**/packages/shared/src/maps/*.map.json",
        "**/packages/shared/src/maps/authored.generated.ts",
        // Painted-ground sidecars, written next to the document.
        "**/apps/web/public/assets/maps/**",
      ],
    },
  },
});
