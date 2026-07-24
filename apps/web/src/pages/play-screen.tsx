import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { GameCanvas } from "@/game/GameCanvas";
import { useBaseCityRoom } from "@/game/useBaseCityRoom";
import { StandPanel } from "@/game/ui/StandPanel";
import { PortalPanel } from "@/game/ui/PortalPanel";
import { FriendsPanel } from "@/game/ui/FriendsPanel";
import { AbilityBar } from "@/game/ui/AbilityBar";
import { StatusBar } from "@/game/ui/StatusBar";
import { useAuth } from "@/providers/auth-provider";
import { useFriends } from "@/hooks/use-friends";
import { LoadingIndicator } from "@/components/application/loading-indicator/loading-indicator";
import { formatWallet } from "@battlebeasts/shared";

const WS_URL = import.meta.env.VITE_GAME_SERVER_URL ?? "ws://localhost:2567";

function PauseCountdown({ until }: { until: number }) {
    const [left, setLeft] = useState(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    useEffect(() => {
        const id = window.setInterval(() => {
            setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
        }, 250);
        return () => window.clearInterval(id);
    }, [until]);
    return <p className="mt-2 text-sm font-medium text-primary">{left}s remaining</p>;
}

export const PlayScreen = () => {
    const { ready, configured, user, profile, accessToken, needsNameSetup, signOut } = useAuth();
    const guestId = useMemo(() => `guest_${Math.random().toString(36).slice(2, 9)}`, []);

    const userId = user?.id ?? guestId;
    const displayName = profile?.display_name ?? user?.user_metadata?.full_name ?? "Hunter";
    const color = profile?.color;

    const [hubOwnerId, setHubOwnerId] = useState<string | null>(null);
    const effectiveHubOwnerId = hubOwnerId ?? userId;

    const canJoinRoom = ready && (!user || (Boolean(profile) && !needsNameSetup));

    const friendsApi = useFriends(user?.id ?? null, user ? effectiveHubOwnerId : null);
    const [helpOpen, setHelpOpen] = useState(true);
    const [friendsOpen, setFriendsOpen] = useState(false);

    const {
        status,
        toast,
        activeUi,
        setActiveUi,
        room,
        localPlayer,
        sendInteract,
        predictedRef,
        phase,
        queueModes,
        contentMode,
        confirmPortal,
        cancelQueue,
        returnToHub,
        economy,
        matchPause,
        cooldownUntil,
        castFlashId,
        fxBursts,
        damagePopups,
        localHp,
    } = useBaseCityRoom({
        endpoint: WS_URL,
        userId,
        displayName,
        color,
        accessToken,
        hubOwnerId: effectiveHubOwnerId,
        enabled: canJoinRoom,
        inputLocked: friendsOpen,
    });

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

    const inContent = phase === "content";

    return (
        <div className="relative h-dvh w-full overflow-hidden bg-black">
            <GameCanvas
                room={room}
                localSessionId={room?.sessionId ?? null}
                predictedRef={predictedRef}
                onInteract={sendInteract}
                phase={phase}
                contentMode={contentMode}
                fxBursts={fxBursts}
                damagePopups={damagePopups}
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center">
                <div className="min-w-[12rem] rounded-full bg-slate-950/70 px-3 py-1.5 ring-1 ring-white/20 backdrop-blur-sm">
                    <div className="mb-0.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-white/70">
                        <span>HP</span>
                        <span className="tabular-nums">
                            {Math.round(localHp.hp)}/{Math.round(localHp.maxHp)}
                        </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                            className="h-full rounded-full bg-emerald-400 transition-[width] duration-150"
                            style={{
                                width: `${Math.max(0, Math.min(100, (localHp.hp / Math.max(1, localHp.maxHp)) * 100))}%`,
                            }}
                        />
                    </div>
                </div>
            </div>

            <div data-ui-overlay className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
                <div className="pointer-events-auto flex flex-col gap-2">
                    <Badge color="brand" size="lg">
                        BattleBeasts
                    </Badge>
                    <Badge color={status === "connected" ? "success" : status === "error" ? "error" : "gray"} size="md">
                        {status}
                        {inContent ? ` · ${contentMode ?? "content"}` : phase === "queued" ? " · queued" : ""}
                    </Badge>
                    {configured && user ? (
                        <Badge color="gray" size="sm">
                            {displayName}
                            {effectiveHubOwnerId !== userId ? " · visiting" : ""}
                        </Badge>
                    ) : (
                        <Badge color="warning" size="sm">
                            Guest
                        </Badge>
                    )}
                    {(friendsApi.requests.length > 0 || friendsApi.invites.length > 0) && (
                        <Badge color="brand" size="sm">
                            {friendsApi.requests.length + friendsApi.invites.length} pending
                        </Badge>
                    )}
                    {!inContent && (
                        <Badge color="gray" size="sm">
                            {formatWallet(economy)}
                        </Badge>
                    )}
                </div>
                <div className="pointer-events-auto flex gap-2">
                    {inContent && (
                        <Button size="sm" color="primary" onClick={returnToHub}>
                            Return to city
                        </Button>
                    )}
                    {user && !inContent && (
                        <Button size="sm" color="secondary" onClick={() => setFriendsOpen(true)}>
                            Friends
                        </Button>
                    )}
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

            {phase === "queued" && (
                <div className="pointer-events-auto absolute inset-x-0 top-20 z-30 mx-auto flex max-w-md flex-col items-center gap-2 rounded-xl bg-primary/95 px-4 py-3 text-center shadow-lg ring-1 ring-secondary">
                    <p className="text-sm font-semibold text-primary">Searching for match…</p>
                    <p className="text-xs text-tertiary">{queueModes.join(" · ") || "PvP"}</p>
                    <Button size="sm" color="secondary" onClick={cancelQueue}>
                        Cancel queue
                    </Button>
                </div>
            )}

            {matchPause && (
                <div className="pointer-events-none absolute inset-x-0 top-20 z-30 mx-auto max-w-md rounded-xl bg-primary/95 px-4 py-3 text-center shadow-lg ring-1 ring-secondary">
                    <p className="text-sm font-semibold text-primary">
                        {matchPause.reason === "resume_grace"
                            ? "Get ready"
                            : matchPause.reason === "pvp_reconnect"
                              ? "PvP paused"
                              : "Encounter paused"}
                    </p>
                    <p className="mt-1 text-xs text-tertiary">
                        {matchPause.reason === "resume_grace"
                            ? "Match resumes shortly"
                            : `Waiting for ${matchPause.playerName ?? "hunter"}${
                                  matchPause.reason === "pvp_reconnect"
                                      ? " — forfeit if they do not return"
                                      : " — party will rebalance"
                              }`}
                    </p>
                    <PauseCountdown until={matchPause.until} />
                </div>
            )}

            <StatusBar room={room} sessionId={room?.sessionId ?? null} />

            <AbilityBar
                loadout={economy.loadout}
                cooldownUntil={cooldownUntil}
                flashId={castFlashId}
            />

            {helpOpen && (
                <div
                    data-ui-overlay
                    className="pointer-events-none absolute bottom-24 left-4 z-20 max-w-sm rounded-xl bg-primary/90 p-4 text-sm text-secondary shadow-lg ring-1 ring-secondary"
                >
                    <p className="font-semibold text-primary">Controls</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                        <li>WASD / arrows — move</li>
                        <li>Mouse aim — character yaw</li>
                        <li>LMB / RMB / Space / Q / E / R — cast</li>
                        <li>Space can interrupt other casts (missile keeps flying if already fired)</li>
                        <li>C / Esc / mouse side buttons — cancel (Bolt: until projectile fires; others: anticipation)</li>
                        <li>F — interact with stands / portals</li>
                        {!inContent && <li>Practice dummy — damage it with abilities for copper</li>}
                    </ul>
                    {localPlayer && (
                        <p className="mt-3 text-tertiary">
                            Pos {localPlayer.x.toFixed(1)}, {localPlayer.z.toFixed(1)}
                        </p>
                    )}
                </div>
            )}

            {toast && (
                <div
                    data-ui-overlay
                    className="absolute bottom-24 right-4 z-30 rounded-lg bg-primary px-4 py-2 text-sm text-primary shadow-lg ring-1 ring-secondary"
                >
                    {toast}
                </div>
            )}

            {activeUi && ["customization", "build", "talent", "shop"].includes(activeUi) && (
                <StandPanel
                    kind={activeUi as "customization" | "build" | "talent" | "shop"}
                    onClose={() => setActiveUi(null)}
                    room={room}
                    economy={economy}
                />
            )}

            {(activeUi === "portal_pvp" || activeUi === "portal_pve") && (
                <PortalPanel
                    kind={activeUi}
                    onClose={() => setActiveUi(null)}
                    onConfirm={confirmPortal}
                />
            )}

            {user && (
                <FriendsPanel
                    open={friendsOpen}
                    onClose={() => setFriendsOpen(false)}
                    friends={friendsApi.friends}
                    requests={friendsApi.requests}
                    invites={friendsApi.invites}
                    loading={friendsApi.loading}
                    error={friendsApi.error}
                    onAddFriend={friendsApi.addFriend}
                    onAnswerRequest={friendsApi.answerRequest}
                    onInviteToHub={friendsApi.sendHubInvite}
                    onAnswerHubInvite={friendsApi.answerHubInvite}
                    onVisitHub={(id) => {
                        setHubOwnerId(id);
                        setFriendsOpen(false);
                    }}
                    onReturnHome={() => setHubOwnerId(null)}
                    currentHubOwnerId={effectiveHubOwnerId}
                    myUserId={userId}
                />
            )}
        </div>
    );
};
