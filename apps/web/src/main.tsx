import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router";
import { HomeScreen } from "@/pages/home-screen";
import { PlayScreen } from "@/pages/play-screen";
import { LoginScreen } from "@/pages/login-screen";
import { AuthCallbackScreen } from "@/pages/auth-callback-screen";
import { NameSetupScreen } from "@/pages/name-setup-screen";
import { NotFound } from "@/pages/not-found";
import { registerAuthoredMaps } from "@battlebeasts/shared";
import { AuthProvider } from "@/providers/auth-provider";
import { RouteProvider } from "@/providers/router-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import "@/styles/globals.css";
import { installSharedPropTextureResolver } from "@/game/propTextureUrls";

// Before any scene mounts: MapScene resolves its geometry from the registry.
registerAuthoredMaps();
installSharedPropTextureResolver();

/** file:// / Electron cannot use path-based BrowserRouter (shows app 404). */
const useHashRouter =
    typeof window !== "undefined" &&
    (window.battlebeasts?.isElectron === true || window.location.protocol === "file:");
const Router = useHashRouter ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider>
            <AuthProvider>
                <Router>
                    <RouteProvider>
                        <Routes>
                            <Route path="/" element={<HomeScreen />} />
                            <Route path="/login" element={<LoginScreen />} />
                            <Route path="/auth/callback" element={<AuthCallbackScreen />} />
                            <Route path="/setup/name" element={<NameSetupScreen />} />
                            <Route path="/play" element={<PlayScreen />} />
                            <Route path="*" element={<NotFound />} />
                        </Routes>
                    </RouteProvider>
                </Router>
            </AuthProvider>
        </ThemeProvider>
    </StrictMode>,
);
