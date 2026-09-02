import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { supabase } from "@/lib/supabase";
import { LoadingIndicator } from "@/components/application/loading-indicator/loading-indicator";
import { useAuth } from "@/providers/auth-provider";

/**
 * Browser Google OAuth lands here with ?code=… (PKCE).
 * Exchange the code, then leave — never wait on profile forever.
 */
export const AuthCallbackScreen = () => {
    const { ready, user, profile, profileError, profileLoading, needsNameSetup, refreshProfile } =
        useAuth();
    const navigate = useNavigate();
    const [error, setError] = useState<string | null>(null);
    const [exchangeDone, setExchangeDone] = useState(false);

    useEffect(() => {
        if (!supabase) {
            setError("Supabase is not configured");
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const url = new URL(window.location.href);
                const oauthError =
                    url.searchParams.get("error_description") ?? url.searchParams.get("error");
                if (oauthError) {
                    if (!cancelled) setError(oauthError);
                    return;
                }

                const code = url.searchParams.get("code");
                if (code) {
                    const { error: exchangeError } =
                        await supabase.auth.exchangeCodeForSession(code);
                    if (exchangeError) {
                        // detectSessionInUrl may have already consumed the code.
                        const { data } = await supabase.auth.getSession();
                        if (!data.session) throw exchangeError;
                    }
                    url.searchParams.delete("code");
                    url.searchParams.delete("state");
                    window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
                } else {
                    const { data, error: sessionError } = await supabase.auth.getSession();
                    if (sessionError) throw sessionError;
                    if (!data.session) {
                        throw new Error("No sign-in session found. Try Google again.");
                    }
                }

                if (!cancelled) setExchangeDone(true);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : "Sign-in callback failed");
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    // Soft watchdog — don't soft-lock the callback on a hung profile row.
    useEffect(() => {
        if (!exchangeDone || !user || profile || profileError) return;
        const id = window.setTimeout(() => {
            void refreshProfile();
            navigate("/play", { replace: true });
        }, 12_000);
        return () => window.clearTimeout(id);
    }, [exchangeDone, user, profile, profileError, refreshProfile, navigate]);

    if (error) {
        return (
            <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-primary px-4 text-center">
                <p className="text-error-primary">{error}</p>
                <a className="text-brand-secondary underline" href="/login">
                    Back to login
                </a>
            </div>
        );
    }

    if (profileError && user && !profile) {
        return (
            <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-primary px-4 text-center">
                <p className="text-error-primary">{profileError}</p>
                <button
                    type="button"
                    className="bb-btn-brass"
                    onClick={() => void refreshProfile()}
                    disabled={profileLoading}
                >
                    Retry profile
                </button>
                <a className="text-brand-secondary underline" href="/login">
                    Back to login
                </a>
            </div>
        );
    }

    if (!ready || !exchangeDone || !user) {
        return (
            <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-primary">
                <LoadingIndicator />
                <p className="text-sm text-white/50">Finishing sign-in…</p>
            </div>
        );
    }

    if (needsNameSetup) {
        return <Navigate to="/setup/name" replace />;
    }

    if (!profile && profileLoading) {
        return (
            <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-primary">
                <LoadingIndicator />
                <p className="text-sm text-white/50">Loading profile…</p>
            </div>
        );
    }

    return <Navigate to="/play" replace />;
};
