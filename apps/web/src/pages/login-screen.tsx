import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { SocialButton } from "@/components/base/buttons/social-button";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Form } from "@/components/base/form/form";
import { Input } from "@/components/base/input/input";
import { ContentDivider } from "@/components/application/content-divider/content-divider";
import { useAuth } from "@/providers/auth-provider";

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
    const [mode, setMode] = useState<"signin" | "signup">("signin");
    const desktop = isDesktopApp();

    if (ready && user) {
        return <Navigate to="/play" replace />;
    }

    const onGoogle = async () => {
        setError(null);
        setInfo(null);
        setLoading(true);
        try {
            await signInWithGoogle();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Google sign-in failed");
            setLoading(false);
        }
    };

    const onEmailSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        setInfo(null);
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
            setError(err instanceof Error ? err.message : "Email auth failed");
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
                        <h1 className="text-xl font-semibold text-primary md:text-display-xs">
                            {mode === "signin" ? "Sign in" : "Create account"}
                        </h1>
                        <p className="text-md text-tertiary">
                            Email login works in the desktop app and unlocks friends / hub invites.
                        </p>
                    </div>
                </div>

                {!configured && (
                    <div className="rounded-xl bg-secondary p-4 text-sm text-secondary ring-1 ring-secondary">
                        <p className="font-medium text-primary">Supabase not configured</p>
                        <p className="mt-1 text-tertiary">
                            Add <code className="text-xs">VITE_SUPABASE_URL</code> and{" "}
                            <code className="text-xs">VITE_SUPABASE_PUBLISHABLE_KEY</code> to{" "}
                            <code className="text-xs">apps/web/.env</code>.
                        </p>
                        <Button className="mt-3" color="secondary" href="/play">
                            Continue as guest
                        </Button>
                    </div>
                )}

                {configured && (
                    <Form onSubmit={onEmailSubmit} className="flex flex-col gap-4">
                        <Input
                            isRequired
                            type="email"
                            name="email"
                            label="Email"
                            placeholder="you@example.com"
                            size="lg"
                            autoComplete="email"
                        />
                        <Input
                            isRequired
                            type="password"
                            name="password"
                            label="Password"
                            placeholder="At least 6 characters"
                            size="lg"
                            autoComplete={mode === "signin" ? "current-password" : "new-password"}
                            minLength={6}
                        />
                        <Button type="submit" size="lg" color="primary" isDisabled={loading || !ready} isLoading={loading}>
                            {mode === "signin" ? "Sign in with email" : "Create account"}
                        </Button>
                        {error && <p className="text-center text-sm text-error-primary">{error}</p>}
                        {info && <p className="text-center text-sm text-tertiary">{info}</p>}
                        <p className="text-center text-sm text-tertiary">
                            {mode === "signin" ? "Need an account?" : "Already have an account?"}{" "}
                            <button
                                type="button"
                                className="font-medium text-brand-secondary underline-offset-2 hover:underline"
                                onClick={() => {
                                    setMode(mode === "signin" ? "signup" : "signin");
                                    setError(null);
                                    setInfo(null);
                                }}
                            >
                                {mode === "signin" ? "Sign up" : "Sign in"}
                            </button>
                        </p>
                    </Form>
                )}

                {configured && (
                    <>
                        <ContentDivider type="single-line">
                            <span className="text-sm font-medium text-tertiary">OR</span>
                        </ContentDivider>
                        <div className="flex flex-col gap-3">
                            {!desktop && (
                                <SocialButton
                                    social="google"
                                    theme="color"
                                    size="lg"
                                    disabled={loading || !ready}
                                    onClick={onGoogle}
                                >
                                    {loading ? "Redirecting…" : "Continue with Google"}
                                </SocialButton>
                            )}
                            <Button size="lg" color="secondary" href="/play">
                                Continue as guest
                            </Button>
                        </div>
                    </>
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
