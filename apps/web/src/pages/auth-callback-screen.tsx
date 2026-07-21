import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { supabase } from "@/lib/supabase";
import { LoadingIndicator } from "@/components/application/loading-indicator/loading-indicator";
import { useAuth } from "@/providers/auth-provider";

export const AuthCallbackScreen = () => {
    const { ready, user, profile, needsNameSetup } = useAuth();
    const [error, setError] = useState<string | null>(null);
    const [sessionReady, setSessionReady] = useState(false);

    useEffect(() => {
        if (!supabase) {
            setError("Supabase is not configured");
            return;
        }

        let cancelled = false;

        (async () => {
            const { error: sessionError } = await supabase.auth.getSession();
            if (cancelled) return;
            if (sessionError) {
                setError(sessionError.message);
                return;
            }
            setSessionReady(true);
        })();

        return () => {
            cancelled = true;
        };
    }, []);

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

    if (!ready || !sessionReady || (user && !profile)) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-primary">
                <LoadingIndicator />
            </div>
        );
    }

    if (needsNameSetup) {
        return <Navigate to="/setup/name" replace />;
    }

    return <Navigate to="/play" replace />;
};
