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
        dedupe: ["three"],
    },
    server: {
        host: true,
        // Allow ngrok / tunnel hostnames during friend playtests
        allowedHosts: true,
    },
}));
