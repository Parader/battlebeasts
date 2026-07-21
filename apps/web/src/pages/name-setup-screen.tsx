import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { useAuth } from "@/providers/auth-provider";

const NAME_RE = /^[A-Za-z0-9_]+$/;

export const NameSetupScreen = () => {
    const { ready, user, profile, needsNameSetup, claimDisplayName, signOut } = useAuth();
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (profile?.display_name) setName(profile.display_name);
    }, [profile?.display_name]);

    if (!ready) return null;

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (profile && !needsNameSetup) {
        return <Navigate to="/play" replace />;
    }

    const validate = (value: string) => {
        const cleaned = value.trim();
        if (cleaned.length < 3 || cleaned.length > 20) return "Name must be 3–20 characters";
        if (!NAME_RE.test(cleaned)) return "Only letters, numbers, and underscores";
        return null;
    };

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const validationError = validate(name);
        if (validationError) {
            setError(validationError);
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await claimDisplayName(name.trim());
        } catch (err) {
            const message = err instanceof Error ? err.message : "Could not save name";
            setError(message.replace(/^.*error:\s*/i, "").split("\n")[0] ?? message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="relative min-h-dvh overflow-hidden bg-primary px-4 py-12 md:px-8 md:pt-24">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--color-brand-100)_0%,_transparent_55%)] opacity-70" />
            <div className="relative mx-auto flex w-full max-w-md flex-col gap-6">
                <div className="flex flex-col items-center gap-3 text-center">
                    <Badge color="brand" size="lg">
                        BattleBeasts
                    </Badge>
                    <h1 className="text-display-xs font-semibold text-primary">Choose your hunter name</h1>
                    <p className="text-md text-tertiary">
                        This name is unique. We picked a random default — change it or keep it.
                    </p>
                </div>

                <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl bg-primary p-5 ring-1 ring-secondary">
                    <Input
                        label="Display name"
                        name="displayName"
                        size="md"
                        value={name}
                        onChange={setName}
                        hint="3–20 characters · letters, numbers, underscore"
                        isInvalid={Boolean(error)}
                        isRequired
                    />
                    {error && <p className="text-sm text-error-primary">{error}</p>}
                    <Button type="submit" size="lg" color="primary" isDisabled={saving || !name}>
                        {saving ? "Saving…" : "Continue"}
                    </Button>
                </form>

                <div className="flex justify-center">
                    <Button color="link-color" size="md" onClick={() => void signOut()}>
                        Sign out
                    </Button>
                </div>
            </div>
        </section>
    );
};
