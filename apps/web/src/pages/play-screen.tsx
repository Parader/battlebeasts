import { useEffect, useLayoutEffect, useState } from "react";
import { Navigate } from "react-router";
import { GameCanvas } from "@/game/GameCanvas";
import { ThirdPersonLookOverlay } from "@/game/ui/ThirdPersonLookOverlay";
import { useBaseCityRoom } from "@/game/useBaseCityRoom";
import { useAssetPreload } from "@/game/useAssetPreload";
import { useVfxGpuReady } from "@/game/useVfxGpuReady";
import { usePropShaderReady } from "@/game/usePropShaderReady";
import { clearVfxGpuReady, markVfxGpuReady } from "@/game/vfx/vfxGpuReady";
import { markPropShaderReady, resetPropShaderReady } from "@/game/propShaderReady";
import { useGameMusic } from "@/game/useGameMusic";
import { useGameAmbiance } from "@/game/useGameAmbiance";
import { EnergyPips } from "@/ui/EnergyPips";
import { NpcDialogue } from "@/game/ui/NpcDialogue";
import { StandPanel } from "@/game/ui/StandPanel";
import { PortalPanel } from "@/game/ui/PortalPanel";
import { FriendsPanel } from "@/game/ui/FriendsPanel";
import { QuestsPanel } from "@/game/ui/QuestsPanel";
import { AdminPanel } from "@/game/ui/AdminPanel";
import { VesselSetupPanel } from "@/game/ui/VesselSetupPanel";
import { RankPanel } from "@/game/ui/RankPanel";
import { ChestRevealPanel } from "@/game/ui/ChestRevealPanel";
import { SettingsPanel } from "@/game/ui/SettingsPanel";
import { PatchNotesPanel } from "@/game/ui/PatchNotesPanel";
import { hasUnseenPatchNotes } from "@/game/patchNotes";
import { DeathOverlay } from "@/game/ui/DeathOverlay";
import { HubRoster } from "@/game/ui/HubRoster";
import { GroupBox, isLiveGroup } from "@/game/ui/GroupBox";
import { ArenaMatchHud } from "@/game/ui/ArenaMatchHud";
import { WaveAssaultHud } from "@/game/ui/WaveAssaultHud";
import { PveUpgradeDraft } from "@/game/ui/PveUpgradeDraft";
import { WaveRunRecapPanel } from "@/game/ui/WaveRunRecapPanel";
import { MatchRecapPanel } from "@/game/ui/MatchRecapPanel";
import { PartyLobbyPanel } from "@/game/ui/PartyLobbyPanel";
import { InvitePromptStack } from "@/game/ui/InvitePromptStack";
import { HudIconButton } from "@/game/ui/HudIconButton";
import { AbilityBar } from "@/game/ui/AbilityBar";
import { FirstBuildChecklist } from "@/game/ui/FirstBuildChecklist";
import { CastBarHud } from "@/game/ui/CastBarHud";
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
import {
    BG_RESPAWN_MS,
    isBattlegroundMode,
    isInstanceMode,
    isPveRunMode,
    isWaveAssaultMode,
    isLoadoutReady,
    TUTORIAL_CHEST_SOURCE,
} from "@battlebeasts/shared";
import { useAuth } from "@/providers/auth-provider";
import { useFriends } from "@/hooks/use-friends";
import { LoadingIndicator } from "@/components/application/loading-indicator/loading-indicator";
import { emptyEmoteSlots, isAdminEmail } from "@battlebeasts/shared";
import { clearPreferredHub, loadLastSocial, savePreferredHub } from "@/game/contentRejoin";

const WS_URL =
    (typeof window !== "undefined" && window.battlebeasts?.gameServerUrl) ||
    import.meta.env.VITE_GAME_SERVER_URL ||
    "ws://127.0.0.1:2568";

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

function ProfileLoadGate({
    message,
    loading,
    onRetry,
    onSignOut,
}: {
    message: string;
    loading: boolean;
    onRetry: () => void;
    onSignOut: () => void;
}) {
    return (
        <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-black px-6 text-center">
            {loading ? <LoadingIndicator /> : null}
            <p className="max-w-md text-sm text-white/80">{message}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" className="bb-btn-brass" onClick={onRetry} disabled={loading}>
                    Retry
                </button>
                <button type="button" className="bb-btn-ink" onClick={onSignOut}>
                    Sign out
                </button>
            </div>
        </div>
    );
}

export const PlayScreen = () => {
    const { ready, configured, user, profile, profileLoading, profileError, accessToken, needsNameSetup, needsVesselSetup, saveVesselChoice, signOut, refreshProfile } = useAuth();

    const userId = user?.id ?? "";
    const displayName = profile?.display_name ?? user?.user_metadata?.full_name ?? "Hunter";
    const color = profile?.color;
    /** Server flag or local allowlist — actions still gated on the game server. */
    const authEmail =
        user?.email ||
        (typeof user?.user_metadata?.email === "string" ? user.user_metadata.email : undefined) ||
        user?.identities
            ?.map((id) => {
                const data = id.identity_data as { email?: string } | undefined;
                return typeof data?.email === "string" ? data.email : undefined;
            })
            .find(Boolean);
    const clientIsAdmin = isAdminEmail(authEmail);

    const [hubOwnerId, setHubOwnerId] = useState<string | null>(null);
    const [wantPlaza, setWantPlaza] = useState(() => loadLastSocial() !== "home");
    const [hubPrefReady] = useState(true);
    const [profileWaitExpired, setProfileWaitExpired] = useState(false);
    const effectiveHubOwnerId = hubOwnerId ?? userId;

    useEffect(() => {
        if (!user?.id) return;
        if (hubOwnerId && hubOwnerId !== user.id) savePreferredHub(user.id, hubOwnerId);
        else if (hubOwnerId === null && !wantPlaza) clearPreferredHub();
    }, [user?.id, hubOwnerId, wantPlaza]);

    // If profile fetch stalls (or never sets error), surface Retry instead of spinning forever.
    useEffect(() => {
        if (profile || profileError || !user) {
            setProfileWaitExpired(false);
            return;
        }
        setProfileWaitExpired(false);
        // Must exceed auth-provider's dual-attempt profile timeout (~24s).
        const id = window.setTimeout(() => setProfileWaitExpired(true), 28_000);
        return () => window.clearTimeout(id);
    }, [profile, profileError, user?.id, profileLoading]);

    const canJoinRoom =
        ready && Boolean(user) && hubPrefReady && Boolean(profile) && !needsNameSetup && Boolean(accessToken);

    const friendsApi = useFriends(
        profile ? (user?.id ?? null) : null,
        profile && user ? effectiveHubOwnerId : null,
    );
    const [helpOpen, setHelpOpen] = useState(false);
    const [friendsOpen, setFriendsOpen] = useState(false);
    const [questsOpen, setQuestsOpen] = useState(false);
    const [adminOpen, setAdminOpen] = useState(false);
    const [rankOpen, setRankOpen] = useState(false);
    const [chestLocksInput, setChestLocksInput] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [updatesOpen, setUpdatesOpen] = useState(false);
    const [confirmReturnHub, setConfirmReturnHub] = useState(false);
    /** True until hub/arena assets + room are ready (locks combat input). */
    const [loadingGate, setLoadingGate] = useState(true);
    const [introPlaying, setIntroPlaying] = useState(false);
    const [confirmSoftReset, setConfirmSoftReset] = useState(false);
    const [vesselSaving, setVesselSaving] = useState(false);

    // Preload needs phase; start with hub until the room reports content.
    const [assetBundle, setAssetBundle] = useState<"hub" | "arena">("hub");
    const { progress, assetsReady } = useAssetPreload(assetBundle, canJoinRoom);
    const vfxGpuReady = useVfxGpuReady();
    const propShaderReady = usePropShaderReady(true);

    const {
        status,
        toast,
        activeUi,
        setActiveUi,
        npcDialogue,
        closeNpcDialogue,
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
        deathSpectate,
        adminTpToMap,
        adminEnterMode,
        spectateTargetId,
        beginDeathSpectate,
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
        waveHud,
        pvePaused,
        setPvePaused,
        pveUpgradeDraft,
        pvePicks,
        pickPveUpgrade,
        plazaState,
        friendLocations,
        requestFriendLocations,
        joinPlaza,
        joinHome,
        joinHub,
        joinFriendPlaza,
        pveFriendlyFire,
        setPveFriendlyFireEnabled,
        waveRunRecap,
        matchRecap,
        voteRematch,
        rankedState,
        rankedLeaderboard,
        pveLeaderboard,
        pveBest,
        refreshRanked,
        party,
        partyInvite,
        inviteFriendToParty,
        inviteToParty,
        setPartySeat,
        setPartyLayout,
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
        wantPlaza,
        enabled: canJoinRoom,
        inputLocked:
            friendsOpen ||
            questsOpen ||
            adminOpen ||
            rankOpen ||
            settingsOpen ||
            updatesOpen ||
            loadingGate ||
            chestLocksInput ||
            introPlaying,
        onActiveHubOwnerId: (id) => {
            if (id && id !== userId) setHubOwnerId(id);
            else if (!id) setHubOwnerId(null);
        },
    });

    const inContent = phase === "content";
    const isAdmin = isHubAdmin || clientIsAdmin;

    useEffect(() => {
        if (!friendsOpen) return;
        requestFriendLocations(friendsApi.friends.map((f) => f.id));
    }, [friendsOpen, friendsApi.friends, requestFriendLocations]);
    useEffect(() => {
        setChestLocksInput(Boolean(chestReveal) || Boolean(pendingChestOpenId));
        if (chestReveal) setQuestsOpen(false);
    }, [chestReveal, pendingChestOpenId]);

    useEffect(() => {
        setAssetBundle(inContent ? "arena" : "hub");
    }, [inContent]);

    // Hub↔content remounts need a fresh GPU warm under new lights/fog.
    // Key off inContent (same signal as GameCanvas warmKey), not assetBundle —
    // assetBundle updates one commit later and can race a completed warm.
    useEffect(() => {
        clearVfxGpuReady();
        resetPropShaderReady();
    }, [inContent]);

    const roomReady = status === "connected" || status === "error";
    const playReady = assetsReady && roomReady && vfxGpuReady && propShaderReady;
    useLayoutEffect(() => {
        setLoadingGate(!playReady);
    }, [playReady]);

    useEffect(() => {
        if (playReady || !assetsReady) return;
        const id = window.setTimeout(() => {
            markVfxGpuReady();
            markPropShaderReady();
        }, 10000);
        return () => window.clearTimeout(id);
    }, [playReady, assetsReady, inContent]);

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

    // First-build checklist replaces the cinematic objective chip.
    useEffect(() => {
        if (playReady && !inContent && !introPlaying) {
            dismissHubIntroObjective();
        }
    }, [playReady, inContent, introPlaying]);

    useEffect(() => {
        if (!playReady || inContent || !user) return;
        refreshHubQuests();
    }, [playReady, inContent, user?.id, refreshHubQuests]);
    useGameMusic(playReady ? (inContent ? "arena" : "village") : null);
    useGameAmbiance(playReady ? (inContent ? "arena" : "village") : null);

    const loadingStatusLabel = !assetsReady
        ? inContent
            ? "Preparing arena"
            : "Building village"
        : !vfxGpuReady
          ? "Warming spell FX"
          : !propShaderReady
            ? inContent
              ? "Warming battlefield"
              : "Warming village props"
            : status === "connecting"
            ? "Connecting"
            : status === "error"
              ? "Connection issue"
              : status === "disconnected"
                ? "Reconnecting"
                : "Almost ready";

    if (!ready) {
        return (
            <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-black">
                <LoadingIndicator />
                <p className="text-sm text-white/50">Checking sign-in…</p>
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
        if (profileError || profileWaitExpired) {
            return (
                <ProfileLoadGate
                    message={
                        profileError ??
                        "Supabase PostgREST is still restarting or unreachable (profile never loaded). Wait a minute after a project restart, then Retry."
                    }
                    loading={profileLoading}
                    onRetry={() => {
                        setProfileWaitExpired(false);
                        void refreshProfile();
                    }}
                    onSignOut={() => void signOut()}
                />
            );
        }
        return (
            <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-black">
                <LoadingIndicator />
                <p className="text-sm text-white/50">
                    {!hubPrefReady ? "Loading hub…" : "Loading profile…"}
                </p>
            </div>
        );
    }

    const isArena = Boolean(arenaHud);
    const isWaveAssault = isWaveAssaultMode(contentMode);
    const isInstance = isInstanceMode(contentMode);
    const isPveRun = isPveRunMode(contentMode);
    const isBattleground = isBattlegroundMode(contentMode);
    const arenaAllowRespawn = !isArena && !isPveRun;
    const isSpectator =
        Boolean(inContent) &&
        (room?.sessionId
            ? (room.state?.players?.get(room.sessionId) as { role?: string } | undefined)?.role ===
              "spectator"
            : false);
    const hpMax = Math.max(1, localHp.maxHp);
    const hpPct = Math.max(0, Math.min(100, (localHp.hp / hpMax) * 100));
    const shieldPct = Math.max(0, Math.min(100, (localHp.shield / hpMax) * 100));
    const shieldLeft = Math.min(hpPct, Math.max(0, 100 - shieldPct));
    const isHubOwner = effectiveHubOwnerId === userId;
    // Appearance + Merchant + chest reveal each spin up a second WebGL Canvas; pause the game
    // view so dual contexts don't fight (gear mesh compile was crashing the tab).
    const suspendGameGl =
        activeUi === "customization" ||
        activeUi === "shop" ||
        Boolean(chestReveal) ||
        (playReady && needsVesselSetup && !introPlaying);

    return (
        <div className="relative h-dvh w-full overflow-hidden bg-black">
            <GameCanvas
                room={room}
                localSessionId={room?.sessionId ?? null}
                predictedRef={predictedRef}
                phase={phase}
                contentMode={contentMode}
                suspended={suspendGameGl}
                spectateTargetId={deathSpectate ? spectateTargetId : null}
            />
            {playReady && isAdmin ? (
                <ThirdPersonLookOverlay
                    predictedRef={predictedRef}
                    locked={
                        Boolean(activeUi) ||
                        adminOpen ||
                        friendsOpen ||
                        questsOpen ||
                        rankOpen ||
                        settingsOpen ||
                        updatesOpen ||
                        introPlaying ||
                        suspendGameGl
                    }
                />
            ) : null}

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

            {playReady && !inContent && !introPlaying && !isSpectator && activeUi !== "build" ? (
                <FirstBuildChecklist
                    loadout={economy.loadout}
                    hasTutorialChest={hubChests.some((c) => c.source === TUTORIAL_CHEST_SOURCE)}
                    onOpenQuests={() => setQuestsOpen(true)}
                />
            ) : null}

            {/*
                Health and energy clear the ability bar, which is now two rows
                tall: the tray itself plus the flex row above it. Centred on the
                same axis as the bar so the three read as one column.
            */}
            {playReady && combatHudVisible && !introPlaying && !isSpectator && (
                <div className="pointer-events-none absolute inset-x-0 bottom-40 z-20 flex justify-center">
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
                        <EnergyPips energy={localHp.energy} />
                    </div>
                </div>
            )}

            {playReady && diedAt != null && !isSpectator && !waveRunRecap && !deathSpectate && (
                <DeathOverlay
                    diedAt={diedAt}
                    animDurationMs={deathAnimMs}
                    onRespawn={requestRespawn}
                    allowRespawn={arenaAllowRespawn}
                    autoRespawn={isBattleground}
                    respawnMs={BG_RESPAWN_MS}
                    onSpectate={!arenaAllowRespawn ? beginDeathSpectate : undefined}
                    fallenHint={
                        isPveRun ? "No respawn — the run ends when all hunters fall." : undefined
                    }
                />
            )}

            {playReady && deathSpectate && (
                <div className="pointer-events-none absolute bottom-8 left-1/2 z-30 -translate-x-1/2 rounded bg-black/55 px-3 py-1.5 text-sm text-white/90">
                    Spectating — Tab / click to cycle
                </div>
            )}

            {playReady && arenaHud && inContent && <ArenaMatchHud hud={arenaHud} />}

            {playReady && isWaveAssault && inContent && pveUpgradeDraft && (
                <PveUpgradeDraft
                    wave={pveUpgradeDraft.wave}
                    kills={pveUpgradeDraft.kills}
                    offers={pveUpgradeDraft.offers}
                    waiting={pveUpgradeDraft.waiting}
                    localSessionId={room?.sessionId ?? null}
                    picked={pveUpgradeDraft.picked}
                    onPick={pickPveUpgrade}
                />
            )}

            {playReady && isPveRun && inContent && !waveRunRecap && (
                <WaveAssaultHud
                    hud={waveHud}
                    paused={pvePaused}
                    onTogglePause={() => setPvePaused(!pvePaused)}
                    onReturnHub={returnToHub}
                    room={room}
                    localSessionId={room?.sessionId ?? null}
                    friendlyFire={pveFriendlyFire}
                    onToggleFriendlyFire={() => setPveFriendlyFireEnabled(!pveFriendlyFire)}
                    picks={pvePicks}
                />
            )}

            {playReady && waveRunRecap && inContent && (
                <WaveRunRecapPanel
                    kills={waveRunRecap.kills}
                    wave={waveRunRecap.wave}
                    bestKills={waveRunRecap.bestKills}
                    isNewBest={waveRunRecap.isNewBest}
                    retryReady={waveRunRecap.retryReady}
                    onRetry={voteRematch}
                    onReturnHub={returnToHub}
                    rows={waveRunRecap.rows}
                    localSessionId={room?.sessionId ?? null}
                    victory={waveRunRecap.victory}
                    chestQuality={waveRunRecap.chestQuality}
                    instance={isInstance}
                />
            )}

            {playReady && matchRecap && inContent && (
                <MatchRecapPanel
                    recap={matchRecap}
                    rematchReady={Boolean(arenaHud?.rematchReady)}
                    localSessionId={room?.sessionId ?? null}
                    isSpectator={isSpectator}
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
                        {effectiveHubOwnerId !== userId && !inContent && !plazaState ? (
                            <span className="bb-chip bb-chip--warn">Visiting</span>
                        ) : null}
                        {!inContent && (
                            <HubRoster
                                players={hubRoster}
                                localSessionId={room?.sessionId ?? null}
                                isHubOwner={isHubOwner}
                                isAdmin={isAdmin}
                                occupancy={
                                    plazaState
                                        ? { current: hubRoster.length, cap: plazaState.walkInCap }
                                        : null
                                }
                                groupSessionIds={
                                    isLiveGroup(party, room?.sessionId ?? null)
                                        ? new Set(party.members.map((m) => m.sessionId))
                                        : undefined
                                }
                                canInviteToGroup={
                                    !party ||
                                    !isLiveGroup(party, room?.sessionId ?? null) ||
                                    party.leaderSessionId === room?.sessionId
                                }
                                onInviteToGroup={inviteToParty}
                                onKick={kickFromHub}
                                onGrantResources={grantHubResources}
                            />
                        )}
                        {playReady &&
                        isLiveGroup(party, room?.sessionId ?? null) &&
                        !inContent &&
                        activeUi !== "party_lobby" ? (
                            <GroupBox
                                members={party.members}
                                leaderSessionId={party.leaderSessionId}
                                localSessionId={room?.sessionId ?? null}
                                onKick={kickFromParty}
                                onLeave={
                                    party.leaderSessionId === room?.sessionId
                                        ? cancelParty
                                        : leaveParty
                                }
                            />
                        ) : null}
                    </div>
                    <div className="pointer-events-auto bb-hud-icon-rail">
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
                                label="Ladders"
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
                        {isAdmin && !inContent && (
                            <HudIconButton
                                label="Admin"
                                icon="wizard-staff"
                                onClick={() => setAdminOpen(true)}
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
                    <p className="bb-panel-sub !mt-0">
                      {queueModes.length > 0 ? `Looking for ${queueModes.join(" · ")}` : "PvP"}
                    </p>
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

            {playReady && !introPlaying && !isSpectator && (
                <StatusBar room={room} sessionId={room?.sessionId ?? null} />
            )}

            {playReady && !introPlaying && !isSpectator && <CastBarHud />}

            {playReady && !introPlaying && !isSpectator && (
                <AbilityBar
                    loadout={economy.loadout}
                    flexLoadout={economy.flexLoadout}
                    flexSlotCount={economy.unlocks?.flexSlotCount ?? 0}
                    energy={localHp.energy}
                    wallet={inContent ? undefined : economy}
                    talentIds={economy.talents}
                    talentBuild={economy.talentBuild}
                    room={room}
                    sessionId={room?.sessionId ?? null}
                />
            )}

            {playReady && !isSpectator && (
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
                        <li>Walk into a portal to open its menu (slot every key first — flex is optional)</li>
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
                                if (room) joinHub(hub);
                                else {
                                    setWantPlaza(false);
                                    setHubOwnerId(hub);
                                }
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

            {/*
              Hidden while a stand panel is up, because talking to a shopkeeper
              opens the shop over the top of the conversation -- the dialogue is
              still live underneath and comes back when the shop is closed.
            */}
            {playReady && npcDialogue && !activeUi && (
                <NpcDialogue
                    npc={npcDialogue}
                    onClose={closeNpcDialogue}
                    onAction={(action) => {
                        closeNpcDialogue();
                        // Quests are a HUD panel rather than a stand, so they
                        // are the one hand-off that is not just a `ui` kind.
                        if (action === "quests") setQuestsOpen(true);
                        else setActiveUi(action);
                    }}
                />
            )}

            {playReady && (activeUi === "portal_pvp" || activeUi === "portal_pve") && (
                <PortalPanel
                    kind={activeUi}
                    onClose={() => setActiveUi(null)}
                    onConfirm={confirmPortal}
                    hubPlayerCount={Math.max(1, hubRoster.length || 1)}
                    loadoutReady={isLoadoutReady(economy.loadout)}
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
                    onSetLayout={setPartyLayout}
                    onKick={kickFromParty}
                    loadoutReady={isLoadoutReady(economy.loadout)}
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
                    localUserId={userId}
                    season={rankedState.season}
                    rating={rankedState.rating}
                    label={rankedState.label}
                    leaderboard={rankedLeaderboard}
                    pveLeaderboard={pveLeaderboard}
                    pveBest={pveBest}
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
                        if (room) joinHome();
                        else {
                            setWantPlaza(false);
                            setHubOwnerId(null);
                        }
                    }}
                    onFindPlaza={() => {
                        clearPreferredHub();
                        if (room) joinPlaza();
                        else {
                            setWantPlaza(true);
                            setHubOwnerId(null);
                        }
                    }}
                    onJoinFriendPlaza={(friendUserId) => {
                        joinFriendPlaza(friendUserId);
                        setFriendsOpen(false);
                    }}
                    onVisitCity={(friendId) => {
                        if (room) joinHub(friendId);
                        else {
                            setWantPlaza(false);
                            setHubOwnerId(friendId);
                        }
                        setFriendsOpen(false);
                    }}
                    friendLocations={friendLocations}
                    currentHubOwnerId={effectiveHubOwnerId}
                    myUserId={userId}
                    inPlaza={Boolean(plazaState)}
                />
            )}

            {playReady && user && (
                <QuestsPanel
                    open={questsOpen}
                    onClose={() => setQuestsOpen(false)}
                    quests={hubQuests}
                    chests={hubChests}
                    onOpenChest={openHubChest}
                    pendingChestOpenId={pendingChestOpenId}
                />
            )}

            {playReady && isAdmin && (
                <AdminPanel
                    open={adminOpen}
                    onClose={() => setAdminOpen(false)}
                    onSpawnChest={spawnHubChest}
                    adminNoCooldown={adminNoCooldown}
                    onToggleAdminNoCooldown={setAdminNoCooldownEnabled}
                    vessel={(localPlayer as { vessel?: string } | null)?.vessel}
                    onSetVessel={(vessel) => {
                        room?.send("set_vessel", { vessel });
                        void saveVesselChoice(vessel);
                    }}
                    onTpToMap={(mapId) => {
                        setAdminOpen(false);
                        adminTpToMap(mapId);
                    }}
                    onEnterMode={(modeId) => {
                        setAdminOpen(false);
                        adminEnterMode(modeId);
                    }}
                    onReplayIntro={() => {
                        setAdminOpen(false);
                        replayHubIntro();
                    }}
                    onSoftResetCharacter={() => {
                        setAdminOpen(false);
                        setConfirmSoftReset(true);
                    }}
                />
            )}

            {playReady && needsVesselSetup && !introPlaying && (
                <VesselSetupPanel
                    open
                    color={profile?.color}
                    pattern={profile?.pattern}
                    patternColor={profile?.pattern_color}
                    saving={vesselSaving}
                    onConfirm={(body) => {
                        setVesselSaving(true);
                        room?.send("set_vessel", { vessel: body });
                        void saveVesselChoice(body).finally(() => setVesselSaving(false));
                    }}
                />
            )}

            {playReady && chestReveal && (
                <ChestRevealPanel
                    reveal={chestReveal}
                    onClose={() => {
                        clearChestReveal();
                        setQuestsOpen(true);
                    }}
                />
            )}

            <ConfirmDialog
                open={playReady && confirmSoftReset}
                title="Soft reset character?"
                message="Resets wallet, loadouts, talents, ranked, quests, chests, and all bought customization back to a blank first-build slate. Keeps your name. The intro will replay."
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
