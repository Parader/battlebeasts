import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, type Plugin } from "vite";

const SHARED_SRC = path.resolve(__dirname, "../../packages/shared/src");

/** Windows often misses chokidar events for files outside apps/web (skin export writes). */
function watchSharedCatalog(): Plugin {
    const cosmetics = path.join(SHARED_SRC, "cosmetics.ts");
    const shopCatalog = path.join(SHARED_SRC, "shopCatalog.ts");
    const watched = new Set([cosmetics, shopCatalog].map((p) => path.normalize(p)));
    return {
        name: "watch-shared-catalog",
        configureServer(server) {
            server.watcher.add([...watched]);
        },
        handleHotUpdate({ file, server }) {
            if (!watched.has(path.normalize(file))) return;
            server.ws.send({ type: "full-reload" });
            return [];
        },
    };
}

export default defineConfig(({ mode }) => ({
    // Electron loads file:// — relative asset URLs required.
    base: mode === "electron" ? "./" : "/",
    plugins: [react(), tailwindcss(), watchSharedCatalog()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
        dedupe: ["three", "three-stdlib"],
    },
    // Keep the catalog as source so skin exports show up in Merchant without a Vite restart.
    optimizeDeps: {
        exclude: ["@battlebeasts/shared"],
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
