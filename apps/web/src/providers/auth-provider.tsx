import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
    isSupabaseConfigured,
    supabase,
    supabasePublishableKey,
    supabaseUrl,
} from "@/lib/supabase";
import type { Profile } from "@/lib/database.types";

type AuthState = {
    ready: boolean;
    configured: boolean;
    session: Session | null;
    user: User | null;
    profile: Profile | null;
    /** True while a signed-in user is waiting on the profiles row. */
    profileLoading: boolean;
    /** Set when profile fetch fails or times out (not when simply missing). */
    profileError: string | null;
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
const SESSION_READY_TIMEOUT_MS = 8_000;
const PROFILE_FETCH_TIMEOUT_MS = 12_000;

const PROFILE_SELECT =
    "id,display_name,avatar_url,color,pattern,pattern_color,name_confirmed,name_changed_at,created_at,updated_at";

function abortableTimeout(ms: number, label = "Profile request"): { signal: AbortSignal; clear: () => void } {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(new Error(`${label} timed out after ${ms}ms`)), ms);
    return {
        signal: ctrl.signal,
        clear: () => window.clearTimeout(t),
    };
}

/**
 * Fetch profile via REST — bypasses supabase-js auth locks that deadlock
 * after OAuth `exchangeCodeForSession` / `onAuthStateChange`.
 */
async function fetchProfileRest(userId: string, accessToken: string): Promise<Profile | null> {
    if (!supabaseUrl || !supabasePublishableKey) return null;

    const qs = new URLSearchParams({
        select: PROFILE_SELECT,
        id: `eq.${userId}`,
    });
    const { signal, clear } = abortableTimeout(PROFILE_FETCH_TIMEOUT_MS, "Profile REST");
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/profiles?${qs}`, {
            headers: {
                apikey: supabasePublishableKey,
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
            },
            signal,
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            // PostgREST restarting: schema cache not ready yet.
            if (res.status === 503 || /PGRST002|schema cache/i.test(body)) {
                throw new Error("PostgREST_RESTARTING");
            }
            throw new Error(
                body
                    ? `Profile load failed (${res.status}): ${body.slice(0, 180)}`
                    : `Profile load failed (${res.status})`,
            );
        }

        const rows = (await res.json()) as Profile[];
        return rows[0] ?? null;
    } finally {
        clear();
    }
}

/** Fallback via supabase-js (also deferred off the auth lock). */
async function fetchProfileClient(userId: string): Promise<Profile | null> {
    if (!supabase) return null;
    const { signal, clear } = abortableTimeout(PROFILE_FETCH_TIMEOUT_MS, "Profile client");
    try {
        const query = supabase
            .from("profiles")
            .select(PROFILE_SELECT)
            .eq("id", userId)
            .maybeSingle();
        const result = await Promise.race([
            query,
            new Promise<never>((_, reject) => {
                signal.addEventListener(
                    "abort",
                    () => reject(signal.reason ?? new Error("Profile client timed out")),
                    { once: true },
                );
            }),
        ]);
        if (result.error) throw result.error;
        return (result.data as Profile | null) ?? null;
    } finally {
        clear();
    }
}

async function fetchProfile(userId: string, accessToken: string): Promise<Profile | null> {
    let restErr: unknown;
    try {
        return await fetchProfileRest(userId, accessToken);
    } catch (err) {
        restErr = err;
        if (err instanceof Error && err.message === "PostgREST_RESTARTING") throw err;
    }
    try {
        return await fetchProfileClient(userId);
    } catch (clientErr) {
        const restMsg = restErr instanceof Error ? restErr.message : String(restErr);
        const clientMsg = clientErr instanceof Error ? clientErr.message : String(clientErr);
        throw new Error(`Profile load failed. REST: ${restMsg} | Client: ${clientMsg}`);
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
        promise.then(
            (v) => {
                window.clearTimeout(t);
                resolve(v);
            },
            (err) => {
                window.clearTimeout(t);
                reject(err);
            },
        );
    });
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
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState<string | null>(null);
    const profileReqId = useRef(0);
    const sessionRef = useRef<Session | null>(null);
    sessionRef.current = session;

    const refreshProfile = useCallback(async (userId?: string) => {
        const id = userId ?? sessionRef.current?.user?.id;
        let token = sessionRef.current?.access_token;
        if (!id || !token) {
            setProfile(null);
            setProfileLoading(false);
            setProfileError(null);
            return;
        }
        const req = ++profileReqId.current;
        setProfileLoading(true);
        setProfileError(null);
        try {
            // Defer past auth lock release after OAuth / onAuthStateChange.
            await new Promise<void>((r) => window.setTimeout(r, 0));
            if (req !== profileReqId.current) return;

            let next: Profile | null = null;
            let lastErr: unknown;
            // PostgREST schema-cache rebuild can take a bit after a project restart.
            for (let attempt = 0; attempt < 8; attempt++) {
                try {
                    if (attempt > 0) {
                        await new Promise<void>((r) => window.setTimeout(r, 1500));
                        if (req !== profileReqId.current) return;
                        if (supabase) {
                            const { data } = await supabase.auth.getSession();
                            token = data.session?.access_token ?? token;
                            if (data.session) setSession(data.session);
                        }
                    }
                    next = await fetchProfile(id, token);
                    lastErr = null;
                    break;
                } catch (err) {
                    lastErr = err;
                    const msg = err instanceof Error ? err.message : "";
                    // Keep looping while API is mid-restart; otherwise stop early on hard errors.
                    if (msg !== "PostgREST_RESTARTING" && !/timed out|aborted|504|503/i.test(msg)) {
                        break;
                    }
                }
            }
            if (req !== profileReqId.current) return;
            if (lastErr) throw lastErr;

            setProfile(next);
            if (!next) {
                setProfileError("No profile found for this account. Try signing out and back in.");
            }
        } catch (err) {
            if (req !== profileReqId.current) return;
            console.error(err);
            setProfile(null);
            const raw = err instanceof Error ? err.message : "Failed to load profile";
            const message =
                raw === "PostgREST_RESTARTING" || /timed out|aborted|504|503|schema cache/i.test(raw)
                    ? "Supabase Data API is restarting (PostgREST schema cache). Wait ~30–60s, then Retry."
                    : raw;
            setProfileError(message);
        } finally {
            if (req === profileReqId.current) setProfileLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!supabase) {
            setReady(true);
            return;
        }

        let cancelled = false;

        void withTimeout(supabase.auth.getSession(), SESSION_READY_TIMEOUT_MS, "Auth session")
            .then(({ data }) => {
                if (cancelled) return;
                setSession(data.session);
                setReady(true);
            })
            .catch((err) => {
                console.error(err);
                if (cancelled) return;
                // Don't soft-lock the whole app on a hung Supabase session read.
                setSession(null);
                setReady(true);
            });

        // Keep callback sync — async work inside onAuthStateChange deadlocks supabase-js.
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

    // Load profile once per user id — don't retrigger on token refresh object identity.
    const userId = session?.user?.id ?? null;
    useEffect(() => {
        if (!userId) {
            profileReqId.current += 1;
            setProfile(null);
            setProfileLoading(false);
            setProfileError(null);
            return;
        }
        void refreshProfile(userId);
    }, [userId, refreshProfile]);

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
        setProfileError(null);
        setProfileLoading(false);
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
        setProfileError(null);
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
            profileLoading,
            profileError,
            accessToken: session?.access_token ?? null,
            needsNameSetup,
            signInWithGoogle,
            signInWithEmail,
            signUpWithEmail,
            signOut,
            refreshProfile: () => refreshProfile(),
            claimDisplayName,
        }),
        [
            ready,
            session,
            profile,
            profileLoading,
            profileError,
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
