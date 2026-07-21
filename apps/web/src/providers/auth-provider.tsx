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
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
    claimDisplayName: (name: string) => Promise<Profile>;
};

const AuthContext = createContext<AuthState | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) {
        console.error("Failed to load profile", error);
        return null;
    }
    return data;
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
        const redirectTo = `${window.location.origin}/auth/callback`;
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo },
        });
        if (error) throw error;
    }, []);

    const signOut = useCallback(async () => {
        if (!supabase) return;
        await supabase.auth.signOut();
        setProfile(null);
    }, []);

    const claimDisplayName = useCallback(async (name: string) => {
        if (!supabase) throw new Error("Supabase is not configured");
        const { data, error } = await supabase.rpc("claim_display_name", { desired_name: name });
        if (error) throw error;
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
            signOut,
            refreshProfile,
            claimDisplayName,
        }),
        [ready, session, profile, needsNameSetup, signInWithGoogle, signOut, refreshProfile, claimDisplayName],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
