import { useMemo, useState } from "react";
import { Navigate } from "react-router";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { GameCanvas } from "@/game/GameCanvas";
import { useBaseCityRoom } from "@/game/useBaseCityRoom";
import { StandPanel } from "@/game/ui/StandPanel";
import { PortalPanel } from "@/game/ui/PortalPanel";
import { useAuth } from "@/providers/auth-provider";
import { LoadingIndicator } from "@/components/application/loading-indicator/loading-indicator";

const WS_URL = import.meta.env.VITE_GAME_SERVER_URL ?? "ws://localhost:2567";

export const PlayScreen = () => {
    const { ready, configured, user, profile, accessToken, needsNameSetup, signOut } = useAuth();
    const guestId = useMemo(() => `guest_${Math.random().toString(36).slice(2, 9)}`, []);

    const userId = user?.id ?? guestId;
    const displayName = profile?.display_name ?? user?.user_metadata?.full_name ?? "Hunter";
    const color = profile?.color;

    const canJoinRoom = ready && (!user || (Boolean(profile) && !needsNameSetup));

    const { status, toast, activeUi, setActiveUi, room, localPlayer, sendInteract, predictedRef } = useBaseCityRoom({
        endpoint: WS_URL,
        userId,
        displayName,
        color,
        accessToken,
        enabled: canJoinRoom,
    });

    const [helpOpen, setHelpOpen] = useState(true);

    if (!ready) {
        return (
            <div className="flex h-dvh items-center justify-center bg-black">
                <LoadingIndicator />
            </div>
        );
    }

    if (user && needsNameSetup) {
        return <Navigate to="/setup/name" replace />;
    }

    return (
        <div className="relative h-dvh w-full overflow-hidden bg-black">
            <GameCanvas
                room={room}
                localSessionId={room?.sessionId ?? null}
                predictedRef={predictedRef}
                onInteract={sendInteract}
            />

            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
                <div className="pointer-events-auto flex flex-col gap-2">
                    <Badge color="brand" size="lg">
                        BattleBeasts
                    </Badge>
                    <Badge color={status === "connected" ? "success" : status === "error" ? "error" : "gray"} size="md">
                        {status}
                    </Badge>
                    {configured && user ? (
                        <Badge color="gray" size="sm">
                            {displayName}
                        </Badge>
                    ) : (
                        <Badge color="warning" size="sm">
                            Guest
                        </Badge>
                    )}
                </div>
                <div className="pointer-events-auto flex gap-2">
                    <Button size="sm" color="secondary" onClick={() => setHelpOpen((v) => !v)}>
                        Controls
                    </Button>
                    {user && (
                        <Button size="sm" color="secondary" onClick={() => void signOut()}>
                            Sign out
                        </Button>
                    )}
                    <Button size="sm" color="tertiary" href="/">
                        Leave
                    </Button>
                </div>
            </div>

            {helpOpen && (
                <div className="pointer-events-none absolute bottom-4 left-4 z-20 max-w-sm rounded-xl bg-primary/90 p-4 text-sm text-secondary shadow-lg ring-1 ring-secondary">
                    <p className="font-semibold text-primary">Controls</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                        <li>WASD / arrows — move</li>
                        <li>Mouse — aim (character yaw)</li>
                        <li>E — interact with stands / portals</li>
                    </ul>
                    {localPlayer && (
                        <p className="mt-3 text-tertiary">
                            Pos {localPlayer.x.toFixed(1)}, {localPlayer.z.toFixed(1)}
                        </p>
                    )}
                </div>
            )}

            {toast && (
                <div className="absolute bottom-4 right-4 z-30 rounded-lg bg-primary px-4 py-2 text-sm text-primary shadow-lg ring-1 ring-secondary">
                    {toast}
                </div>
            )}

            {activeUi && ["customization", "build", "talent", "shop"].includes(activeUi) && (
                <StandPanel
                    kind={activeUi as "customization" | "build" | "talent" | "shop"}
                    onClose={() => setActiveUi(null)}
                    room={room}
                />
            )}

            {(activeUi === "portal_pvp" || activeUi === "portal_pve") && (
                <PortalPanel kind={activeUi} onClose={() => setActiveUi(null)} />
            )}
        </div>
    );
};
