import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { PatchNotesPanel } from "@/game/ui/PatchNotesPanel";
import { hasUnseenPatchNotes } from "@/game/patchNotes";
import { useAuth } from "@/providers/auth-provider";

export const HomeScreen = () => {
    const { ready, configured, user, profile, needsNameSetup, signOut } = useAuth();
    const [updatesOpen, setUpdatesOpen] = useState(false);
    const unseen = hasUnseenPatchNotes();

    return (
        <div className="relative flex min-h-dvh flex-col overflow-hidden bg-primary">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--color-brand-100)_0%,_transparent_55%)] opacity-80" />
            <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
                <Badge color="brand" size="lg">
                    BattleBeasts
                </Badge>
                <h1 className="mt-4 text-display-md font-semibold text-primary">Enter your base city</h1>
                <p className="mt-3 max-w-xl text-lg text-tertiary">
                    Top-down arena combat with stands, portals, and progression.
                </p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    {user ? (
                        <>
                            <Button
                                size="xl"
                                color="primary"
                                href={needsNameSetup ? "/setup/name" : "/play"}
                            >
                                {needsNameSetup
                                    ? "Choose your name"
                                    : `Enter city${profile?.display_name ? ` as ${profile.display_name}` : ""}`}
                            </Button>
                            <Button size="xl" color="secondary" onClick={() => void signOut()}>
                                Sign out
                            </Button>
                        </>
                    ) : (
                        <>
                            {configured && (
                                <Button size="xl" color="primary" href="/login" isDisabled={!ready}>
                                    Sign in
                                </Button>
                            )}
                            <Button size="xl" color="secondary" href="/play" isDisabled={!ready}>
                                Play as guest
                            </Button>
                        </>
                    )}
                    <Button size="xl" color="tertiary" onClick={() => setUpdatesOpen(true)}>
                        {unseen ? "Updates · New" : "Updates"}
                    </Button>
                </div>

                {configured && !user && (
                    <p className="mt-6 max-w-md text-sm text-quaternary">
                        Sign in with email to add friends and visit each other&apos;s hubs. Guests play alone in a private hub.
                    </p>
                )}
                {!configured && (
                    <p className="mt-6 max-w-md text-sm text-quaternary">
                        Auth needs Supabase env vars. Guest play works for local combat testing.
                    </p>
                )}
            </div>

            <PatchNotesPanel open={updatesOpen} onClose={() => setUpdatesOpen(false)} />
        </div>
    );
};
