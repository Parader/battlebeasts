import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
    // Electron loads file:// — relative asset URLs required.
    base: mode === "electron" ? "./" : "/",
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
        dedupe: ["three", "three-stdlib"],
    },
    server: {
        host: true,
        // Allow ngrok / tunnel hostnames during friend playtests
        allowedHosts: true,
        /**
         * Map editor is its own Vite app (port 5183). Ignore its writes so a
         * save or editor-code edit does not kick playtesters out of a match.
         * Refresh the game when you actually want a new map.
         */
        watch: {
            ignored: [
                "**/apps/editor/**",
                "**/packages/shared/src/maps/*.map.json",
                "**/packages/shared/src/maps/authored.generated.ts",
                "**/apps/web/public/assets/maps/**",
            ],
        },
    },
}));
