import { useEffect, useLayoutEffect, useState } from "react";
import { Navigate } from "react-router";
import { GameCanvas } from "@/game/GameCanvas";
import { useBaseCityRoom } from "@/game/useBaseCityRoom";
import { useAssetPreload } from "@/game/useAssetPreload";
import { useVfxGpuReady } from "@/game/useVfxGpuReady";
import { useGameMusic } from "@/game/useGameMusic";
import { useGameAmbiance } from "@/game/useGameAmbiance";
import { StandPanel } from "@/game/ui/StandPanel";
import { PortalPanel } from "@/game/ui/PortalPanel";
import { FriendsPanel } from "@/game/ui/FriendsPanel";
import { QuestsPanel } from "@/game/ui/QuestsPanel";
import { RankPanel } from "@/game/ui/RankPanel";
import { ChestRevealPanel } from "@/game/ui/ChestRevealPanel";
import { SettingsPanel } from "@/game/ui/SettingsPanel";
import { PatchNotesPanel } from "@/game/ui/PatchNotesPanel";
import { hasUnseenPatchNotes } from "@/game/patchNotes";
import { DeathOverlay } from "@/game/ui/DeathOverlay";
import { HubRoster } from "@/game/ui/HubRoster";
import { ArenaMatchHud } from "@/game/ui/ArenaMatchHud";
import { MatchRecapPanel } from "@/game/ui/MatchRecapPanel";
import { PartyLobbyPanel } from "@/game/ui/PartyLobbyPanel";
import { InvitePromptStack } from "@/game/ui/InvitePromptStack";
import { HudIconButton } from "@/game/ui/HudIconButton";
import { AbilityBar } from "@/game/ui/AbilityBar";
import { EmotePieHud } from "@/game/ui/EmotePieHud";
import { StatusBar } from "@/game/ui/StatusBar";
import { ConfirmDialog } from "@/game/ui/ConfirmDialog";
import { GameLoadingOverlay } from "@/game/ui/GameLoadingOverlay";
import { HubIntroOverlay } from "@/game/intro/HubIntroOverlay";
import {
    dismissHubIntroObjective,
    getHubIntroSnapshot,
    resetHubIntroRuntime,
    setHubIntroBeginPoseHandler,
    setHubIntroCompleteHandler,
    startHubIntro,
    subscribeHubIntro,
} from "@/game/intro/hubIntroRuntime";
import { useAuth } from "@/providers/auth-provider";
import { useFriends } from "@/hooks/use-friends";
import { LoadingIndicator } from "@/components/application/loading-indicator/loading-indicator";
import { emptyEmoteSlots } from "@battlebeasts/shared";
import { clearPreferredHub, loadPreferredHub, savePreferredHub } from "@/game/contentRejoin";

const WS_URL =
    (typeof window !== "undefined" && window.battlebeasts?.gameServerUrl) ||
    import.meta.env.VITE_GAME_SERVER_URL ||
    "ws://localhost:2567";

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

    const userId = user?.id ?? "";
    const displayName = profile?.display_name ?? user?.user_metadata?.full_name ?? "Hunter";
    const color = profile?.color;

    const [hubOwnerId, setHubOwnerId] = useState<string | null>(null);
    const [hubPrefReady, setHubPrefReady] = useState(false);
    const effectiveHubOwnerId = hubOwnerId ?? userId;

    // Restore last visited host hub before joining so refresh stays in that lobby.
    useEffect(() => {
        if (!ready || !user?.id) return;
        const preferred = loadPreferredHub(user.id);
        if (preferred) setHubOwnerId(preferred);
        setHubPrefReady(true);
    }, [ready, user?.id]);

    useEffect(() => {
        if (!user?.id || !hubPrefReady) return;
        if (hubOwnerId && hubOwnerId !== user.id) savePreferredHub(user.id, hubOwnerId);
        else if (hubOwnerId === null) clearPreferredHub();
    }, [user?.id, hubOwnerId, hubPrefReady]);

    const canJoinRoom =
        ready && Boolean(user) && hubPrefReady && Boolean(profile) && !needsNameSetup && Boolean(accessToken);

    const friendsApi = useFriends(user?.id ?? null, user ? effectiveHubOwnerId : null);
    const [helpOpen, setHelpOpen] = useState(false);
    const [friendsOpen, setFriendsOpen] = useState(false);
    const [questsOpen, setQuestsOpen] = useState(false);
    const [rankOpen, setRankOpen] = useState(false);
    const [chestLocksInput, setChestLocksInput] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [updatesOpen, setUpdatesOpen] = useState(false);
    const [confirmReturnHub, setConfirmReturnHub] = useState(false);
    /** True until hub/arena assets + room are ready (locks combat input). */
    const [loadingGate, setLoadingGate] = useState(true);
    const [introPlaying, setIntroPlaying] = useState(false);
    const [confirmSoftReset, setConfirmSoftReset] = useState(false);

    // Preload needs phase; start with hub until the room reports content.
    const [assetBundle, setAssetBundle] = useState<"hub" | "arena">("hub");
    const { progress, assetsReady } = useAssetPreload(assetBundle, canJoinRoom);
    const vfxGpuReady = useVfxGpuReady();

    const {
        status,
        toast,
        activeUi,
        setActiveUi,
        room,
        localPlayer,
        predictedRef,
        phase,
        queueModes,
        contentMode,
        confirmPortal,
        cancelQueue,
        returnToHub,
        economy,
        applyLoadoutLocal,
        matchPause,
        localHp,
        combatHudVisible,
        diedAt,
        deathAnimMs,
        requestRespawn,
        hubRoster,
        kickFromHub,
        kickFromParty,
        isHubAdmin,
        adminNoCooldown,
        setAdminNoCooldownEnabled,
        introCompleted,
        introReplayToken,
        grantHubResources,
        beginHubIntroPose,
        completeHubIntro,
        replayHubIntro,
        softResetCharacter,
        hubQuests,
        hubChests,
        unseenQuestCompletions,
        chestReveal,
        pendingChestOpenId,
        refreshHubQuests,
        openHubChest,
        spawnHubChest,
        clearChestReveal,
        acknowledgeQuestAlerts,
        notifyFriendCodeRedeemed,
        arenaHud,
        matchRecap,
        voteRematch,
        rankedState,
        rankedLeaderboard,
        refreshRanked,
        party,
        partyInvite,
        inviteFriendToParty,
        setPartySeat,
        lockParty,
        cancelParty,
        leaveParty,
        respondPartyInvite,
        emotePieOpen,
        emoteAimAngle,
    } = useBaseCityRoom({
        endpoint: WS_URL,
        userId,
        displayName,
        color,
        accessToken,
        hubOwnerId: effectiveHubOwnerId,
        enabled: canJoinRoom,
        inputLocked:
            friendsOpen ||
            questsOpen ||
            rankOpen ||
            settingsOpen ||
            updatesOpen ||
            loadingGate ||
            chestLocksInput ||
            introPlaying,
        onActiveHubOwnerId: (id) => setHubOwnerId(id),
    });

    const inContent = phase === "content";
    useEffect(() => {
        setChestLocksInput(Boolean(chestReveal) || Boolean(pendingChestOpenId));
        if (chestReveal) setQuestsOpen(false);
    }, [chestReveal, pendingChestOpenId]);

    useEffect(() => {
        setAssetBundle(inContent ? "arena" : "hub");
    }, [inContent]);

    const roomReady = status === "connected" || status === "error";
    const playReady = assetsReady && roomReady && vfxGpuReady;
    useLayoutEffect(() => {
        setLoadingGate(!playReady);
    }, [playReady]);

    useEffect(() => {
        return subscribeHubIntro(() => {
            setIntroPlaying(getHubIntroSnapshot().inputLocked);
        });
    }, []);

    useEffect(() => {
        setHubIntroBeginPoseHandler(() => beginHubIntroPose());
        setHubIntroCompleteHandler(() => completeHubIntro());
        return () => {
            setHubIntroBeginPoseHandler(null);
            setHubIntroCompleteHandler(null);
        };
    }, [beginHubIntroPose, completeHubIntro]);

    // Start / replay hub intro once playable and server says not completed.
    useEffect(() => {
        if (!playReady || inContent) {
            resetHubIntroRuntime();
            return;
        }
        if (introCompleted !== false) return;
        if (effectiveHubOwnerId !== userId) return;
        startHubIntro();
    }, [playReady, inContent, introCompleted, introReplayToken, effectiveHubOwnerId, userId]);

    // Dismiss objective when player opens portal UI.
    useEffect(() => {
        if (activeUi === "portal_pvp" || activeUi === "portal_pve") {
            dismissHubIntroObjective();
        }
    }, [activeUi]);

    useEffect(() => {
        if (!playReady || inContent || !user) return;
        refreshHubQuests();
    }, [playReady, inContent, user?.id, refreshHubQuests]);
    useGameMusic(playReady ? (inContent ? "arena" : "village") : null);
    useGameAmbiance(playReady ? (inContent ? "arena" : "village") : null);

    const loadingStatusLabel = !assetsReady
        ? inContent
            ? "Preparing arena"
            : "Preparing hub"
        : !vfxGpuReady
          ? "Warming spell FX"
          : status === "connecting"
            ? "Connecting"
            : status === "error"
              ? "Connection issue"
              : status === "disconnected"
                ? "Reconnecting"
                : "Almost ready";

    if (!ready) {
        return (
            <div className="flex h-dvh items-center justify-center bg-black">
                <LoadingIndicator />
            </div>
        );
    }

    if (!configured || !user) {
        return <Navigate to="/login" replace />;
    }

    if (needsNameSetup) {
        return <Navigate to="/setup/name" replace />;
    }

    if (!profile || !hubPrefReady) {
        return (
            <div className="flex h-dvh items-center justify-center bg-black">
                <LoadingIndicator />
            </div>
        );
    }

    const isArena = Boolean(arenaHud);
    const arenaAllowRespawn = !isArena;
    const hpMax = Math.max(1, localHp.maxHp);
    const hpPct = Math.max(0, Math.min(100, (localHp.hp / hpMax) * 100));
    const shieldPct = Math.max(0, Math.min(100, (localHp.shield / hpMax) * 100));
    const shieldLeft = Math.min(hpPct, Math.max(0, 100 - shieldPct));
    const isHubOwner = effectiveHubOwnerId === userId;
    // Appearance + Merchant + chest reveal each spin up a second WebGL Canvas; pause the game
    // view so dual contexts don't fight (gear mesh compile was crashing the tab).
    const suspendGameGl =
        activeUi === "customization" || activeUi === "shop" || Boolean(chestReveal);

    return (
        <div className="relative h-dvh w-full overflow-hidden bg-black">
            <GameCanvas
                room={room}
                localSessionId={room?.sessionId ?? null}
                predictedRef={predictedRef}
                phase={phase}
                contentMode={contentMode}
                suspended={suspendGameGl}
            />

            {!playReady ? (
                <GameLoadingOverlay
                    percent={
                        assetsReady && vfxGpuReady
                            ? 100
                            : assetsReady
                              ? 98
                              : Math.min(95, progress.percent)
                    }
                    statusLabel={loadingStatusLabel}
                />
            ) : null}

            {playReady && !inContent ? <HubIntroOverlay /> : null}

            {playReady && combatHudVisible && !introPlaying && (
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
            )}

            {playReady && diedAt != null && (
                <DeathOverlay
                    diedAt={diedAt}
                    animDurationMs={deathAnimMs}
                    onRespawn={requestRespawn}
                    allowRespawn={arenaAllowRespawn}
                />
            )}

            {playReady && arenaHud && inContent && <ArenaMatchHud hud={arenaHud} />}

            {playReady && matchRecap && inContent && (
                <MatchRecapPanel
                    recap={matchRecap}
                    rematchReady={Boolean(arenaHud?.rematchReady)}
                    localSessionId={room?.sessionId ?? null}
                    onRematch={voteRematch}
                    onReturnHub={returnToHub}
                />
            )}

            {playReady && !introPlaying ? (
                <div
                    data-ui-overlay
                    className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4"
                >
                    <div className="pointer-events-auto flex flex-col gap-2">
                        <span
                            className={[
                                "bb-chip",
                                status === "connected"
                                    ? "bb-chip--ok"
                                    : status === "error" || status === "disconnected"
                                      ? "bb-chip--err"
                                      : "bb-chip--warn",
                            ].join(" ")}
                        >
                            {status}
                            {inContent
                                ? ` · ${contentMode ?? "content"}`
                                : phase === "queued"
                                  ? " · queued"
                                  : ""}
                        </span>
                        {effectiveHubOwnerId !== userId && !inContent ? (
                            <span className="bb-chip bb-chip--warn">Visiting</span>
                        ) : null}
                        {!inContent && (
                            <HubRoster
                                players={hubRoster}
                                localSessionId={room?.sessionId ?? null}
                                isHubOwner={isHubOwner}
                                isAdmin={isHubAdmin}
                                onKick={kickFromHub}
                                onGrantResources={grantHubResources}
                            />
                        )}
                    </div>
                    <div className="pointer-events-auto bb-hud-icon-rail">
                        {party && !inContent && activeUi !== "party_lobby" && (
                            <HudIconButton
                                label="Party lobby"
                                icon="party-flags"
                                accent
                                onClick={() => setActiveUi("party_lobby")}
                            />
                        )}
                        {inContent && (
                            <HudIconButton
                                label="Return to city"
                                icon="return-arrow"
                                accent
                                onClick={() => setConfirmReturnHub(true)}
                            />
                        )}
                        {user && !inContent && (
                            <HudIconButton
                                label="Ranked"
                                icon="party-flags"
                                onClick={() => {
                                    setRankOpen(true);
                                    refreshRanked();
                                }}
                            />
                        )}
                        {user && !inContent && (
                            <HudIconButton
                                label="Friends"
                                icon="three-friends"
                                onClick={() => setFriendsOpen(true)}
                                badge={
                                    friendsApi.requests.length > 0
                                        ? friendsApi.requests.length > 9
                                            ? "9+"
                                            : friendsApi.requests.length
                                        : null
                                }
                            />
                        )}
                        {user && !inContent && (
                            <HudIconButton
                                label="Quests"
                                icon="locked-chest"
                                onClick={() => {
                                    setQuestsOpen(true);
                                    acknowledgeQuestAlerts();
                                    refreshHubQuests();
                                }}
                                badge={
                                    hubChests.length + unseenQuestCompletions > 0
                                        ? hubChests.length + unseenQuestCompletions > 9
                                            ? "9+"
                                            : hubChests.length + unseenQuestCompletions
                                        : null
                                }
                            />
                        )}
                        <HudIconButton
                            label={hasUnseenPatchNotes() ? "Updates · New" : "Updates"}
                            icon="scroll-unfurled"
                            onClick={() => setUpdatesOpen(true)}
                            badge={hasUnseenPatchNotes() ? "!" : null}
                        />
                        <HudIconButton
                            label="Settings"
                            icon="cog"
                            onClick={() => setSettingsOpen(true)}
                        />
                        <HudIconButton
                            label="Controls"
                            icon="help"
                            active={helpOpen}
                            onClick={() => setHelpOpen((v) => !v)}
                        />
                        <HudIconButton
                            label="Leave"
                            icon="exit-door"
                            onClick={() => {
                                void (async () => {
                                    if (user) await signOut();
                                    window.location.assign("/");
                                })();
                            }}
                        />
                    </div>
                </div>
            ) : null}

            {playReady && phase === "queued" && (
                <div
                    data-ui-overlay
                    className="bb-parchment bb-toast pointer-events-auto absolute inset-x-0 top-20 z-30 mx-auto flex max-w-md flex-col items-center gap-3 px-5 py-4 text-center"
                >
                    <p className="bb-panel-title !text-xl">Searching for match…</p>
                    <p className="bb-panel-sub !mt-0">{queueModes.join(" · ") || "PvP"}</p>
                    <button type="button" className="bb-btn-ink" onClick={cancelQueue}>
                        Cancel queue
                    </button>
                </div>
            )}

            {playReady && matchPause && (
                <div
                    data-ui-overlay
                    className="bb-parchment bb-toast pointer-events-none absolute inset-x-0 top-20 z-30 mx-auto max-w-md px-5 py-4 text-center"
                >
                    <p className="bb-panel-title !text-xl">
                        {matchPause.reason === "resume_grace"
                            ? "Get ready"
                            : matchPause.reason === "pvp_reconnect"
                              ? "PvP paused"
                              : "Encounter paused"}
                    </p>
                    <p className="bb-panel-sub">
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

            {playReady && !introPlaying && <StatusBar room={room} sessionId={room?.sessionId ?? null} />}

            {playReady && !introPlaying && (
                <AbilityBar
                    loadout={economy.loadout}
                    wallet={inContent ? undefined : economy}
                />
            )}

            {playReady && !inContent && (
                <EmotePieHud
                    slots={economy.unlocks?.emoteSlots ?? emptyEmoteSlots()}
                    aimAngleRad={emoteAimAngle}
                    visible={emotePieOpen}
                />
            )}

            {playReady && helpOpen && (
                <div
                    data-ui-overlay
                    className="bb-parchment bb-toast pointer-events-none absolute bottom-24 left-4 z-20 max-w-sm px-4 py-3.5"
                >
                    <p className="bb-panel-title !text-lg">Controls</p>
                    <ul className="bb-muted mt-3 list-disc space-y-1.5 pl-4">
                        <li>WASD / arrows — move</li>
                        <li>Mouse aim — character yaw</li>
                        <li>LMB / RMB / Space / Q / E / R / F — cast</li>
                        <li>Space can interrupt other casts (missile keeps flying if already fired)</li>
                        <li>In a shop / stand zone, Space opens the menu instead of casting</li>
                        <li>Walk into a portal to open its menu</li>
                        <li>
                            C / Esc / mouse side buttons — cancel (Bolt: until projectile fires; others:
                            anticipation)
                        </li>
                        {!inContent && (
                            <li>Hold V — emote wheel (aim with mouse, release to dance; WASD cancels)</li>
                        )}
                        {!inContent && <li>Practice dummy — train abilities (no coin rewards)</li>}
                    </ul>
                    {localPlayer && (
                        <p className="bb-meta mt-3">
                            Pos {localPlayer.x.toFixed(1)}, {localPlayer.z.toFixed(1)}
                        </p>
                    )}
                </div>
            )}

            {playReady && toast && (
                <div
                    data-ui-overlay
                    className="bb-parchment bb-toast absolute bottom-24 right-4 z-30 px-4 py-2 text-sm"
                >
                    {toast}
                </div>
            )}

            {playReady && friendsApi.friendRequestToast && (
                <div
                    data-ui-overlay
                    className="bb-parchment bb-toast pointer-events-auto absolute bottom-36 right-4 z-35 max-w-xs px-4 py-2.5 text-sm"
                    role="status"
                >
                    {friendsApi.friendRequestToast}
                </div>
            )}

            {playReady && (
                <InvitePromptStack
                    partyInvite={partyInvite}
                    onPartyAccept={() => respondPartyInvite(true)}
                    onPartyDecline={() => respondPartyInvite(false)}
                    hubInvites={user && !inContent ? friendsApi.invites : []}
                    onHubAccept={(id) => {
                        void friendsApi.answerHubInvite(id, true).then((hub) => {
                            if (hub && user?.id) {
                                savePreferredHub(user.id, hub);
                                setHubOwnerId(hub);
                            }
                        });
                    }}
                    onHubDecline={(id) => {
                        void friendsApi.answerHubInvite(id, false);
                    }}
                    friendRequests={user && !inContent ? friendsApi.requests : []}
                    onFriendAccept={(id) => {
                        void friendsApi.answerRequest(id, true);
                    }}
                    onFriendDecline={(id) => {
                        void friendsApi.answerRequest(id, false);
                    }}
                />
            )}

            {playReady &&
                activeUi &&
                ["customization", "build", "talent", "shop"].includes(activeUi) && (
                    <StandPanel
                        kind={activeUi as "customization" | "build" | "talent" | "shop"}
                        onClose={() => setActiveUi(null)}
                        room={room}
                        economy={economy}
                        localSessionId={room?.sessionId ?? null}
                        onLoadoutChange={applyLoadoutLocal}
                    />
                )}

            {playReady && (activeUi === "portal_pvp" || activeUi === "portal_pve") && (
                <PortalPanel
                    kind={activeUi}
                    onClose={() => setActiveUi(null)}
                    onConfirm={confirmPortal}
                    hubPlayerCount={Math.max(1, hubRoster.length || 1)}
                />
            )}

            {playReady && activeUi === "party_lobby" && party && (
                <PartyLobbyPanel
                    party={party}
                    localSessionId={room?.sessionId ?? null}
                    hubPlayers={hubRoster}
                    friends={friendsApi.friends.map((f) => ({
                        id: f.id,
                        displayName: f.display_name,
                        online: f.online,
                    }))}
                    onInviteFriend={(friendUserId) => {
                        inviteFriendToParty(friendUserId);
                        const alreadyInHub = hubRoster.some((h) => h.userId === friendUserId);
                        if (!alreadyInHub) {
                            void friendsApi.sendHubInvite(friendUserId);
                        }
                    }}
                    onSetSeat={setPartySeat}
                    onKick={kickFromParty}
                    onLock={lockParty}
                    onCancel={cancelParty}
                    onLeave={leaveParty}
                    onClose={() => setActiveUi(null)}
                />
            )}

            {playReady && (
                <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            )}

            {playReady && (
                <PatchNotesPanel open={updatesOpen} onClose={() => setUpdatesOpen(false)} />
            )}

            {playReady && user && (
                <RankPanel
                    open={rankOpen}
                    onClose={() => setRankOpen(false)}
                    season={rankedState.season}
                    rating={rankedState.rating}
                    label={rankedState.label}
                    leaderboard={rankedLeaderboard}
                    onRefresh={refreshRanked}
                />
            )}

            {playReady && user && (
                <FriendsPanel
                    open={friendsOpen}
                    onClose={() => setFriendsOpen(false)}
                    friends={friendsApi.friends}
                    friendCode={friendsApi.friendCode}
                    hasRedeemedCode={friendsApi.hasRedeemedCode}
                    loading={friendsApi.loading}
                    error={friendsApi.error}
                    onAddFriend={friendsApi.addFriend}
                    onRedeemFriendCode={async (code) => {
                        await friendsApi.redeemCode(code);
                        notifyFriendCodeRedeemed();
                    }}
                    onInviteToHub={friendsApi.sendHubInvite}
                    onRemoveFriend={friendsApi.removeFriend}
                    onReturnHome={() => {
                        clearPreferredHub();
                        setHubOwnerId(null);
                    }}
                    currentHubOwnerId={effectiveHubOwnerId}
                    myUserId={userId}
                />
            )}

            {playReady && user && (
                <QuestsPanel
                    open={questsOpen}
                    onClose={() => setQuestsOpen(false)}
                    quests={hubQuests}
                    chests={hubChests}
                    isAdmin={isHubAdmin}
                    onOpenChest={openHubChest}
                    pendingChestOpenId={pendingChestOpenId}
                    onSpawnChest={spawnHubChest}
                    adminNoCooldown={adminNoCooldown}
                    onToggleAdminNoCooldown={setAdminNoCooldownEnabled}
                    onReplayIntro={() => {
                        setQuestsOpen(false);
                        replayHubIntro();
                    }}
                    onSoftResetCharacter={() => {
                        setQuestsOpen(false);
                        setConfirmSoftReset(true);
                    }}
                />
            )}

            {playReady && chestReveal && (
                <ChestRevealPanel reveal={chestReveal} onClose={clearChestReveal} />
            )}

            <ConfirmDialog
                open={playReady && confirmSoftReset}
                title="Soft reset character?"
                message="Resets wallet, loadouts, talents, quests, and all bought customization (colors, patterns, cosmetics, emotes) back to starter slate. Keeps your name. The intro will replay."
                confirmLabel="Reset"
                onConfirm={() => {
                    setConfirmSoftReset(false);
                    softResetCharacter();
                }}
                onCancel={() => setConfirmSoftReset(false)}
            />

            <ConfirmDialog
                open={playReady && confirmReturnHub}
                title="Return to city?"
                message="Leave this match and return to your base city?"
                confirmLabel="Return to city"
                onConfirm={() => {
                    setConfirmReturnHub(false);
                    returnToHub();
                }}
                onCancel={() => setConfirmReturnHub(false)}
            />
        </div>
    );
};
