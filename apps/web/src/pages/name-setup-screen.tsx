import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { useAuth } from "@/providers/auth-provider";

const NAME_RE = /^[A-Za-z0-9_]+$/;

function normalizeName(value: unknown): string {
    return String(value ?? "").trim();
}

function validateName(value: string): string | null {
    if (value.length < 3 || value.length > 20) return "Name must be 3–20 characters";
    if (!NAME_RE.test(value)) return "Only letters, numbers, and underscores";
    return null;
}

export const NameSetupScreen = () => {
    const { ready, user, profile, needsNameSetup, claimDisplayName, signOut } = useAuth();
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [seeded, setSeeded] = useState(false);

    useEffect(() => {
        if (seeded || !profile?.display_name) return;
        setName(profile.display_name);
        setSeeded(true);
    }, [profile?.display_name, seeded]);

    if (!ready) return null;

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (profile && !needsNameSetup) {
        return <Navigate to="/play" replace />;
    }

    const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        // Prefer the live field value (FormData) so submit is not stuck on stale React state.
        const data = new FormData(e.currentTarget);
        const cleaned = normalizeName(data.get("displayName") || name);
        setName(cleaned);

        const validationError = validateName(cleaned);
        if (validationError) {
            setError(validationError);
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await claimDisplayName(cleaned);
        } catch (err) {
            const message =
                err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
                    ? (err as { message: string }).message
                    : err instanceof Error
                      ? err.message
                      : "Could not save name";
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
                    <label className="flex w-full flex-col gap-1.5">
                        <span className="text-sm font-medium text-secondary">
                            Display name <span className="text-brand-secondary">*</span>
                        </span>
                        <input
                            name="displayName"
                            type="text"
                            required
                            minLength={3}
                            maxLength={20}
                            autoComplete="nickname"
                            spellCheck={false}
                            value={name}
                            onChange={(ev) => {
                                setName(ev.target.value);
                                if (error) setError(null);
                            }}
                            className="w-full rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary shadow-xs ring-1 ring-primary outline-hidden ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
                            aria-invalid={Boolean(error) || undefined}
                        />
                        <span className="text-sm text-tertiary">3–20 characters · letters, numbers, underscore</span>
                    </label>
                    {error && <p className="text-sm text-error-primary">{error}</p>}
                    <Button type="submit" size="lg" color="primary" isDisabled={saving || normalizeName(name).length < 3}>
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
