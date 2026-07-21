import { useState } from "react";
import { Navigate } from "react-router";
import { SocialButton } from "@/components/base/buttons/social-button";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { useAuth } from "@/providers/auth-provider";

export const LoginScreen = () => {
    const { ready, configured, user, signInWithGoogle } = useAuth();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    if (ready && user) {
        return <Navigate to="/play" replace />;
    }

    const onGoogle = async () => {
        setError(null);
        setLoading(true);
        try {
            await signInWithGoogle();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Google sign-in failed");
            setLoading(false);
        }
    };

    return (
        <section className="relative min-h-dvh overflow-hidden bg-primary px-4 py-12 md:px-8 md:pt-24">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--color-brand-100)_0%,_transparent_55%)] opacity-70" />
            <div className="relative mx-auto flex w-full flex-col gap-8 sm:max-w-90">
                <div className="flex flex-col items-center gap-6 text-center">
                    <Badge color="brand" size="lg">
                        BattleBeasts
                    </Badge>
                    <div className="flex flex-col gap-2 md:gap-3">
                        <h1 className="text-xl font-semibold text-primary md:text-display-xs">Enter the arena</h1>
                        <p className="text-md text-tertiary">Sign in to spawn in your base city.</p>
                    </div>
                </div>

                {!configured && (
                    <div className="rounded-xl bg-secondary p-4 text-sm text-secondary ring-1 ring-secondary">
                        <p className="font-medium text-primary">Supabase not configured</p>
                        <p className="mt-1 text-tertiary">
                            Add <code className="text-xs">VITE_SUPABASE_URL</code> and{" "}
                            <code className="text-xs">VITE_SUPABASE_PUBLISHABLE_KEY</code> to{" "}
                            <code className="text-xs">apps/web/.env</code>, enable Google provider, then apply{" "}
                            <code className="text-xs">supabase/migrations</code>.
                        </p>
                        <Button className="mt-3" color="secondary" href="/play">
                            Continue as guest
                        </Button>
                    </div>
                )}

                {configured && (
                    <div className="flex flex-col gap-3">
                        <SocialButton social="google" theme="color" size="lg" disabled={loading || !ready} onClick={onGoogle}>
                            {loading ? "Redirecting…" : "Continue with Google"}
                        </SocialButton>
                        {error && <p className="text-center text-sm text-error-primary">{error}</p>}
                    </div>
                )}

                <div className="flex justify-center">
                    <Button color="link-color" size="md" href="/">
                        Back
                    </Button>
                </div>
            </div>
        </section>
    );
};
