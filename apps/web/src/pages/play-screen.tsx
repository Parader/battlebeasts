import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router";
import { GameCanvas } from "@/game/GameCanvas";
import { useBaseCityRoom } from "@/game/useBaseCityRoom";
import { StandPanel } from "@/game/ui/StandPanel";
import { PortalPanel } from "@/game/ui/PortalPanel";
import { FriendsPanel } from "@/game/ui/FriendsPanel";
import { DeathOverlay } from "@/game/ui/DeathOverlay";
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
    return <p className="mt-2 text-sm text-[var(--bb-ink-soft)]">{left}s remaining</p>;
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
        diedAt,
        deathAnimMs,
        requestRespawn,
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
    const hpMax = Math.max(1, localHp.maxHp);
    const hpPct = Math.max(0, Math.min(100, (localHp.hp / hpMax) * 100));
    const shieldPct = Math.max(0, Math.min(100, (localHp.shield / hpMax) * 100));
    // Sit on the right of current HP; if that would overflow, overlay the bar's right edge.
    const shieldLeft = Math.min(hpPct, Math.max(0, 100 - shieldPct));

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
                <div className="bb-hp-tray">
                    <div className="bb-hp-tray__label">
                        <span>HP</span>
                        <span className="tabular-nums">
                            {Math.round(localHp.hp)}/{Math.round(localHp.maxHp)}
                            {localHp.shield > 0 ? (
                                <span className="bb-hp-tray__shield-amt"> +{Math.round(localHp.shield)}</span>
                            ) : null}
                        </span>
                    </div>
                    <div className="bb-hp-tray__track">
                        <div className="bb-hp-tray__fill" style={{ width: `${hpPct}%` }} />
                        {shieldPct > 0 ? (
                            <div
                                className="bb-hp-tray__shield"
                                style={{ left: `${shieldLeft}%`, width: `${shieldPct}%` }}
                            />
                        ) : null}
                    </div>
                </div>
            </div>

            {diedAt != null && (
                <DeathOverlay diedAt={diedAt} animDurationMs={deathAnimMs} onRespawn={requestRespawn} />
            )}

            <div data-ui-overlay className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
                <div className="pointer-events-auto flex flex-col gap-2">
                    <span className="bb-chip text-[0.75rem]">BattleBeasts</span>
                    <span
                        className={[
                            "bb-chip",
                            status === "connected" ? "bb-chip--ok" : status === "error" ? "bb-chip--err" : "",
                        ].join(" ")}
                    >
                        {status}
                        {inContent ? ` · ${contentMode ?? "content"}` : phase === "queued" ? " · queued" : ""}
                    </span>
                    {configured && user ? (
                        <span className="bb-chip">
                            {displayName}
                            {effectiveHubOwnerId !== userId ? " · visiting" : ""}
                        </span>
                    ) : (
                        <span className="bb-chip bb-chip--warn">Guest</span>
                    )}
                    {(friendsApi.requests.length > 0 || friendsApi.invites.length > 0) && (
                        <span className="bb-chip bb-chip--warn">
                            {friendsApi.requests.length + friendsApi.invites.length} pending
                        </span>
                    )}
                    {!inContent && <span className="bb-chip">{formatWallet(economy)}</span>}
                </div>
                <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
                    {inContent && (
                        <button type="button" className="bb-btn-brass" onClick={returnToHub}>
                            Return to city
                        </button>
                    )}
                    {user && !inContent && (
                        <button type="button" className="bb-btn-ink" onClick={() => setFriendsOpen(true)}>
                            Friends
                        </button>
                    )}
                    <button type="button" className="bb-btn-ink" onClick={() => setHelpOpen((v) => !v)}>
                        Controls
                    </button>
                    {user && (
                        <button type="button" className="bb-btn-ink" onClick={() => void signOut()}>
                            Sign out
                        </button>
                    )}
                    <a className="bb-btn-ink inline-block no-underline" href="/">
                        Leave
                    </a>
                </div>
            </div>

            {phase === "queued" && (
                <div
                    data-ui-overlay
                    className="bb-parchment bb-toast pointer-events-auto absolute inset-x-0 top-20 z-30 mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-3 text-center"
                >
                    <p className="bb-title text-sm">Searching for match…</p>
                    <p className="text-xs text-[var(--bb-ink-soft)]">{queueModes.join(" · ") || "PvP"}</p>
                    <button type="button" className="bb-btn-ink" onClick={cancelQueue}>
                        Cancel queue
                    </button>
                </div>
            )}

            {matchPause && (
                <div
                    data-ui-overlay
                    className="bb-parchment bb-toast pointer-events-none absolute inset-x-0 top-20 z-30 mx-auto max-w-md px-4 py-3 text-center"
                >
                    <p className="bb-title text-sm">
                        {matchPause.reason === "resume_grace"
                            ? "Get ready"
                            : matchPause.reason === "pvp_reconnect"
                              ? "PvP paused"
                              : "Encounter paused"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--bb-ink-soft)]">
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
                    className="bb-parchment bb-toast pointer-events-none absolute bottom-24 left-4 z-20 max-w-sm p-4 text-sm"
                >
                    <p className="bb-title text-sm">Controls</p>
                    <div className="bb-brass-rule my-2" />
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[var(--bb-ink-soft)]">
                        <li>WASD / arrows — move</li>
                        <li>Mouse aim — character yaw</li>
                        <li>LMB / RMB / Space / Q / E / R — cast</li>
                        <li>Space can interrupt other casts (missile keeps flying if already fired)</li>
                        <li>C / Esc / mouse side buttons — cancel (Bolt: until projectile fires; others: anticipation)</li>
                        <li>F — interact with stands / portals</li>
                        {!inContent && <li>Practice dummy — damage it with abilities for copper</li>}
                    </ul>
                    {localPlayer && (
                        <p className="mt-3 text-xs text-[var(--bb-ink-soft)]">
                            Pos {localPlayer.x.toFixed(1)}, {localPlayer.z.toFixed(1)}
                        </p>
                    )}
                </div>
            )}

            {toast && (
                <div
                    data-ui-overlay
                    className="bb-parchment bb-toast absolute bottom-24 right-4 z-30 px-4 py-2 text-sm"
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
                    localSessionId={room?.sessionId ?? null}
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
