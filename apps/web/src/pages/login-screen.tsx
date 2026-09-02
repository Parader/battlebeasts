import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { SocialButton } from "@/components/base/buttons/social-button";
import { APP_DISPLAY_NAME } from "@/brand";
import { useAuth } from "@/providers/auth-provider";
import { AuthShell } from "./auth/AuthShell";

function isDesktopApp() {
    return (
        typeof window !== "undefined" &&
        (window.battlebeasts?.isElectron === true || window.location.protocol === "file:")
    );
}

export const LoginScreen = () => {
    const { ready, configured, user, signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [awaitingBrowser, setAwaitingBrowser] = useState(false);
    const [mode, setMode] = useState<"signin" | "signup">("signin");
    const desktop = isDesktopApp();

    useEffect(() => {
        if (!awaitingBrowser) return;
        const id = window.setTimeout(() => {
            setAwaitingBrowser(false);
            setInfo("Browser sign-in timed out. Try Google again.");
        }, 5 * 60_000);
        return () => window.clearTimeout(id);
    }, [awaitingBrowser]);

    useEffect(() => {
        if (user) setAwaitingBrowser(false);
    }, [user]);

    useEffect(() => {
        const onOauthError = (event: Event) => {
            const detail = (event as CustomEvent<string>).detail;
            setAwaitingBrowser(false);
            setLoading(false);
            setError(typeof detail === "string" ? detail : "Desktop Google sign-in failed");
            void window.battlebeasts?.cancelDesktopOAuth?.();
            void window.battlebeasts?.cancelOAuthLoopback?.();
        };
        window.addEventListener("bb-desktop-oauth-error", onOauthError);
        return () => window.removeEventListener("bb-desktop-oauth-error", onOauthError);
    }, []);

    if (ready && user) {
        return <Navigate to="/play" replace />;
    }

    const onGoogle = async () => {
        setError(null);
        setInfo(null);
        setLoading(true);
        try {
            await signInWithGoogle();
            if (desktop) {
                setAwaitingBrowser(true);
                setInfo(
                    `Continue in your browser. After Google, allow opening ${APP_DISPLAY_NAME} — sign-in finishes in the app.`,
                );
                setLoading(false);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Google sign-in failed");
            setAwaitingBrowser(false);
            setLoading(false);
        }
    };

    const onEmailSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        setInfo(null);
        setAwaitingBrowser(false);
        setLoading(true);
        const data = new FormData(e.currentTarget);
        const email = String(data.get("email") ?? "");
        const password = String(data.get("password") ?? "");
        try {
            if (mode === "signin") {
                await signInWithEmail(email, password);
            } else {
                const result = await signUpWithEmail(email, password);
                if (result.needsEmailConfirmation) {
                    setInfo("Check your email to confirm the account, then sign in here.");
                    setMode("signin");
                    setLoading(false);
                    return;
                }
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Email auth failed";
            const already =
                (err instanceof Error &&
                    (err as Error & { code?: string }).code === "user_already_exists") ||
                /already registered|already been registered|user already exists/i.test(message);
            if (already && mode === "signup") {
                setMode("signin");
            }
            setError(message);
            setLoading(false);
        }
    };

    return (
        <AuthShell showBack layout="split">
            <h2 className="bb-auth-panel__title">
                {mode === "signin" ? "Enter the trials" : "Create your account"}
            </h2>
            <p className="bb-auth-panel__lead">
                Sign in to play, add friends, and join ranked matches.
            </p>

            {!configured && (
                <div className="bb-auth-warn">
                    <strong>Supabase not configured</strong>
                    Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to{" "}
                    <code>apps/web/.env</code>.
                </div>
            )}

            {configured && (
                <form onSubmit={onEmailSubmit} className="bb-auth-form">
                    <label className="bb-auth-label">
                        Email
                        <input
                            className="bb-input"
                            required
                            type="email"
                            name="email"
                            placeholder="you@example.com"
                            autoComplete="email"
                        />
                    </label>
                    <label className="bb-auth-label">
                        Password
                        <input
                            className="bb-input"
                            required
                            type="password"
                            name="password"
                            placeholder="At least 6 characters"
                            autoComplete={mode === "signin" ? "current-password" : "new-password"}
                            minLength={6}
                        />
                    </label>
                    <button
                        type="submit"
                        className="bb-btn-brass"
                        disabled={loading || !ready}
                    >
                        {loading
                            ? "Working…"
                            : mode === "signin"
                              ? "Sign in with email"
                              : "Create account"}
                    </button>
                    {error && <p className="bb-auth-error">{error}</p>}
                    {info && <p className="bb-auth-info">{info}</p>}
                    <p className="bb-auth-switch">
                        {mode === "signin" ? "Need an account?" : "Already have an account?"}{" "}
                        <button
                            type="button"
                            onClick={() => {
                                setMode(mode === "signin" ? "signup" : "signin");
                                setError(null);
                                setInfo(null);
                            }}
                        >
                            {mode === "signin" ? "Sign up" : "Sign in"}
                        </button>
                    </p>
                </form>
            )}

            {configured && (
                <>
                    <div className="bb-auth-divider">Or</div>
                    <div className="bb-auth-form">
                        <div className="bb-auth-google">
                            <SocialButton
                                social="google"
                                theme="color"
                                size="lg"
                                disabled={loading || awaitingBrowser || !ready}
                                onClick={onGoogle}
                            >
                                {awaitingBrowser
                                    ? "Waiting for browser…"
                                    : loading
                                      ? desktop
                                          ? "Opening browser…"
                                          : "Redirecting…"
                                      : "Continue with Google"}
                            </SocialButton>
                        </div>
                        {awaitingBrowser && (
                            <button
                                type="button"
                                className="bb-btn-ink"
                                onClick={() => {
                                    void window.battlebeasts?.cancelDesktopOAuth?.();
                                    void window.battlebeasts?.cancelOAuthLoopback?.();
                                    setAwaitingBrowser(false);
                                    setInfo(null);
                                }}
                            >
                                Cancel browser sign-in
                            </button>
                        )}
                    </div>
                </>
            )}
        </AuthShell>
    );
};
