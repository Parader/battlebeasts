import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { HomeScreen } from "@/pages/home-screen";
import { PlayScreen } from "@/pages/play-screen";
import { LoginScreen } from "@/pages/login-screen";
import { AuthCallbackScreen } from "@/pages/auth-callback-screen";
import { NameSetupScreen } from "@/pages/name-setup-screen";
import { NotFound } from "@/pages/not-found";
import { AuthProvider } from "@/providers/auth-provider";
import { RouteProvider } from "@/providers/router-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import "@/styles/globals.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider>
            <AuthProvider>
                <BrowserRouter>
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
                </BrowserRouter>
            </AuthProvider>
        </ThemeProvider>
    </StrictMode>,
);
