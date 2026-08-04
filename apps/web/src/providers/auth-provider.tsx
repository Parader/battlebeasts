import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/database.types";

type AuthState = {
    ready: boolean;
    configured: boolean;
    session: Session | null;
    user: User | null;
    profile: Profile | null;
    accessToken: string | null;
    needsNameSetup: boolean;
    signInWithGoogle: () => Promise<void>;
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
    claimDisplayName: (name: string) => Promise<Profile>;
};

const AuthContext = createContext<AuthState | null>(null);

/** Dedicated desktop loopback (must match Electron main + Supabase redirect allowlist). */
const DESKTOP_OAUTH_WEB_REDIRECT = "http://127.0.0.1:3847/auth/callback";

async function fetchProfile(userId: string): Promise<Profile | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) {
        console.error("Failed to load profile", error);
        return null;
    }
    return data;
}

function parseAuthCallbackUrl(url: string): URL | null {
    try {
        return new URL(url);
    } catch {
        // Some Windows protocol deliveries omit a proper host.
        try {
            return new URL(url.replace(/^battlebeasts:\/*/i, "https://callback/"));
        } catch {
            return null;
        }
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(!isSupabaseConfigured);
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);

    const refreshProfile = useCallback(async () => {
        if (!session?.user) {
            setProfile(null);
            return;
        }
        const next = await fetchProfile(session.user.id);
        setProfile(next);
    }, [session?.user]);

    useEffect(() => {
        if (!supabase) {
            setReady(true);
            return;
        }

        let cancelled = false;

        supabase.auth.getSession().then(({ data }) => {
            if (cancelled) return;
            setSession(data.session);
            setReady(true);
        });

        const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
            setSession(next);
        });

        return () => {
            cancelled = true;
            sub.subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!supabase) return;

        let cancelled = false;
        let inFlightCode: string | null = null;
        let finishedCode: string | null = null;

        const fail = (err: unknown) => {
            console.error("Desktop OAuth callback failed", err);
            window.dispatchEvent(
                new CustomEvent("bb-desktop-oauth-error", {
                    detail: err instanceof Error ? err.message : "Desktop Google sign-in failed",
                }),
            );
            void window.battlebeasts?.cancelDesktopOAuth?.();
        };

        const consumeAuthUrl = async (url: string) => {
            if (cancelled || !supabase) return;
            // Focus-only deep links carry no session payload.
            if (/^battlebeasts:\/\/focus\/?/i.test(url) && !/[?&]code=/.test(url)) return;

            const parsed = parseAuthCallbackUrl(url);
            if (!parsed) {
                fail(new Error("Invalid auth callback URL"));
                return;
            }

            const oauthError =
                parsed.searchParams.get("error_description") ?? parsed.searchParams.get("error");
            if (oauthError) {
                fail(new Error(oauthError));
                return;
            }

            const code = parsed.searchParams.get("code");
            if (!code) return;
            if (code === finishedCode || code === inFlightCode) return;

            inFlightCode = code;
            try {
                const { data, error } = await supabase.auth.exchangeCodeForSession(code);
                if (error) throw error;
                const nextSession =
                    data.session ?? (await supabase.auth.getSession()).data.session ?? null;
                if (!nextSession) {
                    throw new Error(
                        "Browser signed in, but the app could not create a session (PKCE). Try Google again.",
                    );
                }
                finishedCode = code;
                setSession(nextSession);
                void window.battlebeasts?.clearPendingOAuthCallback?.();
                void window.battlebeasts?.cancelDesktopOAuth?.();
            } catch (err) {
                // A duplicate "already used" code after success is harmless.
                if (finishedCode === code) return;
                const message =
                    err && typeof err === "object" && "message" in err && typeof (err as Error).message === "string"
                        ? (err as Error).message
                        : err instanceof Error
                          ? err.message
                          : "Desktop Google sign-in failed";
                fail(new Error(message));
            } finally {
                if (inFlightCode === code) inFlightCode = null;
            }
        };

        const unsub = window.battlebeasts?.onAuthCallback?.((url) => {
            void consumeAuthUrl(url);
        });

        const pollId = window.setInterval(() => {
            void (async () => {
                const pending = await window.battlebeasts?.takePendingOAuthCallback?.();
                if (pending) await consumeAuthUrl(pending);
            })();
        }, 500);

        return () => {
            cancelled = true;
            window.clearInterval(pollId);
            unsub?.();
        };
    }, []);

    useEffect(() => {
        if (!session?.user) {
            setProfile(null);
            return;
        }
        void refreshProfile();
    }, [session?.user, refreshProfile]);

    const signInWithGoogle = useCallback(async () => {
        if (!supabase) {
            throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
        }

        const desktop = window.battlebeasts?.isElectron === true;
        if (desktop) {
            const desktopOAuth = await window.battlebeasts?.beginDesktopOAuth?.();
            if (desktopOAuth && !desktopOAuth.ok) {
                throw new Error(desktopOAuth.error ?? "Could not start desktop OAuth listener");
            }
            const redirectTo =
                desktopOAuth?.ok && desktopOAuth.redirectTo
                    ? desktopOAuth.redirectTo
                    : DESKTOP_OAUTH_WEB_REDIRECT;

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo,
                    skipBrowserRedirect: true,
                },
            });
            if (error) {
                void window.battlebeasts?.cancelDesktopOAuth?.();
                throw error;
            }
            if (!data.url) {
                void window.battlebeasts?.cancelDesktopOAuth?.();
                throw new Error("No OAuth URL returned");
            }

            const opened = await window.battlebeasts?.openExternal?.(data.url);
            if (opened === false) {
                void window.battlebeasts?.cancelDesktopOAuth?.();
                throw new Error("Could not open system browser");
            }
            return;
        }

        const redirectTo = `${window.location.origin}/auth/callback`;
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo },
        });
        if (error) throw error;
    }, []);

    const signInWithEmail = useCallback(async (email: string, password: string) => {
        if (!supabase) {
            throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
        }
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
    }, []);

    const signUpWithEmail = useCallback(async (email: string, password: string) => {
        if (!supabase) {
            throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
        }
        const trimmed = email.trim();
        const { data, error } = await supabase.auth.signUp({ email: trimmed, password });
        if (error) {
            const already =
                error.code === "user_already_exists" ||
                /already registered|already been registered|user already exists/i.test(error.message);
            if (already) {
                const err = new Error(
                    "That email is already registered. Sign in instead — if you used Google before, tap Continue with Google.",
                );
                (err as Error & { code?: string }).code = "user_already_exists";
                throw err;
            }
            throw error;
        }
        return { needsEmailConfirmation: Boolean(data.user) && !data.session };
    }, []);

    const signOut = useCallback(async () => {
        if (!supabase) return;
        await supabase.auth.signOut();
        setProfile(null);
    }, []);

    const claimDisplayName = useCallback(async (name: string) => {
        if (!supabase) throw new Error("Supabase is not configured");
        const desired_name = String(name ?? "").trim();
        if (desired_name.length < 3 || desired_name.length > 20) {
            throw new Error("Name must be 3–20 characters");
        }
        const { data, error } = await supabase.rpc("claim_display_name", { desired_name });
        if (error) {
            const detail = [error.message, error.details, error.hint].filter(Boolean).join(" — ");
            throw new Error(detail || "Could not save name");
        }
        const next = data as Profile;
        setProfile(next);
        return next;
    }, []);

    const needsNameSetup = Boolean(session?.user && profile && profile.name_confirmed !== true);

    const value = useMemo<AuthState>(
        () => ({
            ready,
            configured: isSupabaseConfigured,
            session,
            user: session?.user ?? null,
            profile,
            accessToken: session?.access_token ?? null,
            needsNameSetup,
            signInWithGoogle,
            signInWithEmail,
            signUpWithEmail,
            signOut,
            refreshProfile,
            claimDisplayName,
        }),
        [
            ready,
            session,
            profile,
            needsNameSetup,
            signInWithGoogle,
            signInWithEmail,
            signUpWithEmail,
            signOut,
            refreshProfile,
            claimDisplayName,
        ],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
