import { useState } from "react";
import { Link } from "react-router";
import { APP_TAGLINE } from "@/brand";
import { PatchNotesPanel } from "@/game/ui/PatchNotesPanel";
import { hasUnseenPatchNotes } from "@/game/patchNotes";
import { useAuth } from "@/providers/auth-provider";
import { AuthShell } from "./auth/AuthShell";

export const HomeScreen = () => {
    const { ready, configured, user, profile, needsNameSetup, signOut } = useAuth();
    const [updatesOpen, setUpdatesOpen] = useState(false);
    const unseen = hasUnseenPatchNotes();

    return (
        <AuthShell layout="center" subtitle={APP_TAGLINE}>
            <div className="bb-auth-actions">
                {user ? (
                    <>
                        <Link
                            className="bb-btn-brass"
                            to={needsNameSetup ? "/setup/name" : "/play"}
                        >
                            {needsNameSetup
                                ? "Choose your name"
                                : `Enter city${profile?.display_name ? ` as ${profile.display_name}` : ""}`}
                        </Link>
                        <button type="button" className="bb-btn-ink" onClick={() => void signOut()}>
                            Sign out
                        </button>
                    </>
                ) : (
                    <Link
                        className="bb-btn-brass"
                        to="/login"
                        aria-disabled={!ready || !configured || undefined}
                        onClick={(e) => {
                            if (!ready || !configured) e.preventDefault();
                        }}
                        style={!ready || !configured ? { pointerEvents: "none", opacity: 0.45 } : undefined}
                    >
                        Sign in to play
                    </Link>
                )}
                <button type="button" className="bb-btn-ink" onClick={() => setUpdatesOpen(true)}>
                    {unseen ? "Updates · New" : "Updates"}
                </button>
            </div>

            {configured && !user && (
                <p className="bb-auth-info" style={{ marginTop: "1rem" }}>
                    Sign in with email or Google to play, add friends, and visit each other&apos;s hubs.
                </p>
            )}
            {!configured && (
                <p className="bb-auth-info" style={{ marginTop: "1rem" }}>
                    Auth needs Supabase env vars in <code>apps/web/.env</code>.
                </p>
            )}

            <PatchNotesPanel open={updatesOpen} onClose={() => setUpdatesOpen(false)} />
        </AuthShell>
    );
};
