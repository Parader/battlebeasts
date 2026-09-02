import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { APP_DISPLAY_NAME } from "@/brand";
import { useAuth } from "@/providers/auth-provider";
import { AuthShell } from "./auth/AuthShell";

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
        <AuthShell layout="split" subtitle="Claim the name others will face in the trials.">
            <h2 className="bb-auth-panel__title">Choose your mage name</h2>
            <p className="bb-auth-panel__lead">
                Unique across {APP_DISPLAY_NAME}. We picked a random default — change it or keep it.
            </p>

            <form onSubmit={onSubmit} className="bb-auth-form">
                <label className="bb-auth-label">
                    Display name
                    <input
                        className="bb-input"
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
                        aria-invalid={Boolean(error) || undefined}
                    />
                    <span style={{ fontWeight: 400, letterSpacing: 0 }}>
                        3–20 characters · letters, numbers, underscore
                    </span>
                </label>
                {error && <p className="bb-auth-error">{error}</p>}
                <button
                    type="submit"
                    className="bb-btn-brass"
                    disabled={saving || normalizeName(name).length < 3}
                >
                    {saving ? "Saving…" : "Continue"}
                </button>
            </form>

            <div className="bb-auth-actions" style={{ marginTop: "0.75rem" }}>
                <button type="button" className="bb-btn-ink" onClick={() => void signOut()}>
                    Sign out
                </button>
            </div>
        </AuthShell>
    );
};
