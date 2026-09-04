import { useCallback, useEffect, useRef, useState } from "react";
import { Client, Room } from "colyseus.js";
import { ABILITIES, ASTRAL_CHAIN_CAST, COMBAT_ENGAGE_LINGER_MS, EMPTY_FLEX_LOADOUT, flexCost, fireballChargeWindowWallMs, HAND_SHIELD_CAST, PLAYER_BASE_MAX_HP, ROOM, baseCityStaticColliders, mapCollidersFor, mapIdForMode, mapNpcsFor, HUB_NPCS, npcElementIdFrom, npcInteractId, NPC_INTERACT_RADIUS, type NpcPlacement, canInterruptOtherCast, canPlayerCancelCast, channelChargeDistance, castBarShowsChannel, castBarShowsWindup, castWindupMs, phaseDurationMs, combineStatusMoveMul, getStatus, normalizeFlexLoadout, normalizeLoadout, stepYawToward, totalShieldAbsorb, unitCollidersExcept, riftPortalColliders, volcanoColliders, slotIndexForInput, HUB_STANDS, HUB_PORTALS, HUB_PRACTICE_DUMMIES, pointInInteractZone, interactZoneDist, EMOTE_PIE_SLOT_COUNT, emptyEmoteSlots, angleToEmoteSlotIndex, getEmote, formatRankLabel, normalizeRankSnapshot, type FlexLoadout, type MatchRecapRow, type PartySnapshot, type PlayerInput, type PvpSeat, type RankSnapshot } from "@battlebeasts/shared";
import { clearContentRejoin, clearHubRejoin, clearPreferredHub, loadContentRejoin, loadHubRejoin, loadPreferredHub, saveContentRejoin, saveHubRejoin, savePreferredHub } from "./contentRejoin";
import { recordWaveBestRun } from "./waveBestRun";
import { LocalPredictor } from "./LocalPredictor";
import type { DamagePopup } from "./CombatVfx";
import { combatOverlayRuntime } from "./combatOverlayRuntime";
import { setWorldStaticColliders } from "./worldCollidersRuntime";
import { clearInteractPrompt, setInteractPrompt } from "./interactPromptRuntime";
import { setTalkingNpc } from "./npcRuntime";
import type { NpcDialogueData } from "./ui/NpcDialogue";
import { abilityHudRuntime } from "./abilityHudRuntime";
import { spawnImpactEffect, cancelFollowOwnerVfx, usesFrostMistFx, usesGrooveFx, usesHealBeamFx, usesLifeLeechFx, clearCrescentSpawnState } from "./vfx";
import { cancelActiveCastHandle } from "./vfx/runtime/playerVfxRuntime";
import { dispatchCombatFxVfx } from "./vfx/combatFxDispatch";
import { takePortalChannelBubbleScale } from "./vfx/portalChannelRuntime";
import { castBarRuntime, chargeHudRuntime } from "./castBarRuntime";
import { setActiveEmote, clearActiveEmote, isEmoteActive } from "./emoteRuntime";
import { getGroundAim } from "./groundAimRuntime";
import { castAimRuntime } from "./castAimRuntime";
import { hasStatusId } from "./StatusOrnaments";
import { beginRevengeVanish } from "./revengeVanishRuntime";
import {
  beginTeleportSlamFadeIn,
  beginTeleportSlamFadeOut,
} from "./teleportSlamFadeRuntime";

const FX_COLORS: Record<"aoe" | "melee" | "dash" | "hit", string> = {
    aoe: "#c084fc",
    melee: "#fb923c",
    dash: "#a3e635",
    hit: "#f87171",
};

/** Soft-lock guard — Colyseus join/reconnect can hang forever on a black-holed host. */
const ROOM_CONNECT_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = window.setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
        promise.then(
            (v) => {
                window.clearTimeout(t);
                resolve(v);
            },
            (err) => {
                window.clearTimeout(t);
                reject(err);
            },
        );
    });
}

/** Reused empty static collider list for non-hub / non-arena phases. */
const EMPTY_STATICS: ReturnType<typeof baseCityStaticColliders> = [];
/** Hub walls/portals — singleton; never rebuild per frame. */
const HUB_STATICS = baseCityStaticColliders();

/**
 * Map colliders, built once per map.
 *
 * These must be the exact set `ContentRoom` gives the server, or prediction
 * and authority disagree every frame and the player visibly stutters against
 * anything solid. Both sides now read the same registry, so a mode pointed at
 * a new map cannot drift out of sync.
 */
const MAP_STATICS = new Map<string, ReturnType<typeof mapCollidersFor>>();

function staticsForMap(mapId: string) {
    let cached = MAP_STATICS.get(mapId);
    if (!cached) {
        cached = mapCollidersFor(mapId);
        MAP_STATICS.set(mapId, cached);
    }
    return cached;
}

/** Movement key codes — closing the emote pie / cancelling an active emote shares this set. */
const MOVE_KEY_CODES = new Set([
    "KeyW",
    "ArrowUp",
    "KeyS",
    "ArrowDown",
    "KeyA",
    "ArrowLeft",
    "KeyD",
    "ArrowRight",
]);

const DAMAGE_POPUP_LIFE_MS = 900;

export type ActiveUi =
    | "customization"
    | "build"
    | "talent"
    | "shop"
    | "portal_pvp"
    | "portal_pve"
    | "party_lobby"
    | null;

export type SessionPhase = "hub" | "queued" | "content";

/** True while still in the village room (including matchmaking queue). */
function isHubWorld(phase: SessionPhase): boolean {
    return phase === "hub" || phase === "queued";
}

/** Hub pad under the local player (prompt / Space interact / portal auto-open). */
export type NearInteract = {
    id: string;
    label: string;
    kind: "stand" | "portal" | "dummy" | "npc";
} | null;

/** NPCs authored into whichever map a content mode resolves to. */
function npcsForMode(mode: string | null): NpcPlacement[] {
    const mapId = mapIdForMode(mode);
    return mapId ? mapNpcsFor(mapId) : [];
}

/** NPCs for the current phase — hub uses the village document, content uses its mode map. */
function npcsForSession(phase: SessionPhase, mode: string | null): NpcPlacement[] {
    if (isHubWorld(phase)) return [...HUB_NPCS];
    return npcsForMode(mode);
}

function staticsForPhase(phase: SessionPhase, mode: string | null) {
    if (isHubWorld(phase)) return HUB_STATICS;
    const mapId = mapIdForMode(mode);
    if (mapId) return staticsForMap(mapId);
    return EMPTY_STATICS;
}

export type MatchPauseInfo = {
    reason: "pvp_reconnect" | "pve_reconnect" | "resume_grace";
    until: number;
    playerName?: string;
} | null;

export type HubRosterPlayer = {
    sessionId: string;
    userId?: string;
    displayName: string;
    isOwner: boolean;
};

export type ArenaHudState = {
    matchPhase: string;
    matchRound: number;
    scoreA: number;
    scoreB: number;
    scoreC?: number;
    phaseEndsAt: number;
    matchMode: string;
    localTeam: string;
    rematchReady: boolean;
};

/** Mirrors ContentRoom.canCombat — casts only (emotes use a separate gate). */
function clientCanCombat(opts: {
    hp?: number;
    roundDead?: boolean;
    role?: string;
    matchPhase?: string;
}): boolean {
    if (opts.role === "spectator") return false;
    if (typeof opts.hp === "number" && opts.hp <= 0) return false;
    if (opts.roundDead) return false;
    const phase = opts.matchPhase ?? "";
    if (phase === "countdown" || phase === "round_end" || phase === "match_end") return false;
    return true;
}

/**
 * Mirrors ContentRoom.canMove — spectators always move;
 * living fighters can walk during round_end celebrate window.
 */
function clientCanMove(opts: {
    hp?: number;
    roundDead?: boolean;
    role?: string;
    matchPhase?: string;
}): boolean {
    if (opts.role === "spectator") return true;
    if (opts.matchPhase === "round_end") {
        if (typeof opts.hp === "number" && opts.hp <= 0) return false;
        if (opts.roundDead) return false;
        return true;
    }
    return clientCanCombat(opts);
}

export type MatchRecapState = {
    winner: "a" | "b" | "c" | "draw";
    scoreA: number;
    scoreB: number;
    scoreC?: number;
    matchKind?: "ranked" | "custom";
    rows: MatchRecapRow[];
};

export type PredictedPose = {
    x: number;
    z: number;
    yaw: number;
};

type Options = {
    endpoint: string;
    userId: string;
    displayName: string;
    color?: string;
    accessToken?: string | null;
    hubOwnerId?: string;
    enabled?: boolean;
    /** When true, WASD/arrows/casts are ignored so UI typing works. */
    inputLocked?: boolean;
    /** Sync React visit state when reconnect picks a different host hub (or falls back home). */
    onActiveHubOwnerId?: (hubOwnerId: string | null) => void;
};

type TransferMsg = {
    room: string;
    roomId?: string;
    options?: Record<string, unknown>;
};

export function useBaseCityRoom(options: Options) {
    const [status, setStatus] = useState<"connecting" | "connected" | "error" | "disconnected">("connecting");
    const [toast, setToast] = useState<string | null>(null);
    const [activeUi, setActiveUi] = useState<ActiveUi>(null);
    const [npcDialogue, setNpcDialogue] = useState<NpcDialogueData | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [phase, setPhase] = useState<SessionPhase>("hub");
    const [queueModes, setQueueModes] = useState<string[]>([]);
    const [contentMode, setContentMode] = useState<string | null>(null);
    const [matchPause, setMatchPause] = useState<MatchPauseInfo>(null);
    const [localHp, setLocalHp] = useState({
        hp: PLAYER_BASE_MAX_HP,
        maxHp: PLAYER_BASE_MAX_HP,
        shield: 0,
        energy: 0,
    });
    const [combatHudVisible, setCombatHudVisible] = useState(false);
    const combatHudLingerUntilRef = useRef(0);
    const prevLocalHpRef = useRef<number | null>(null);
    const [diedAt, setDiedAt] = useState<number | null>(null);
    const [deathAnimMs, setDeathAnimMs] = useState(3000);
    const diedAtRef = useRef<number | null>(null);
    /** Local camera-only spectate after arena/wave death (no server role flip). */
    const [deathSpectate, setDeathSpectate] = useState(false);
    const deathSpectateRef = useRef(false);
    const [spectateTargetId, setSpectateTargetId] = useState<string | null>(null);
    const spectateTargetIdRef = useRef<string | null>(null);
    const [hubRoster, setHubRoster] = useState<HubRosterPlayer[]>([]);
    const [isHubAdmin, setIsHubAdmin] = useState(false);
    const [adminNoCooldown, setAdminNoCooldownState] = useState(false);
    const adminNoCooldownRef = useRef(false);
    /** Hub intro cinematic — false until server says completed or not owner. */
    const [introCompleted, setIntroCompleted] = useState<boolean | null>(null);
    const [introReplayToken, setIntroReplayToken] = useState(0);
    const [hubQuests, setHubQuests] = useState<
        Array<{
            id: string;
            label: string;
            type: string;
            target: number;
            chest: string;
            progress: number;
            completed: boolean;
        }>
    >([]);
    const [hubChests, setHubChests] = useState<
        Array<{ id: string; quality: string; source: string; created_at?: string }>
    >([]);
    const [chestReveal, setChestReveal] = useState<{
        quality: string;
        essence: number;
        copper: number;
        lines: import("@battlebeasts/shared").ChestLootLine[];
        awaitingLoot?: boolean;
    } | null>(null);
    const [pendingChestOpenId, setPendingChestOpenId] = useState<string | null>(null);
    /** Unseen quest completions (cleared when Quests panel opens). */
    const [unseenQuestCompletions, setUnseenQuestCompletions] = useState(0);
    const seenQuestCompletionsRef = useRef<Set<string>>(new Set());
    const knownChestIdsRef = useRef<Set<string>>(new Set());
    const questsHydratedRef = useRef(false);
    const [arenaHud, setArenaHud] = useState<ArenaHudState | null>(null);
    const [waveHud, setWaveHud] = useState<{
        wave: number;
        phase: string;
        alive: number;
        goal: number;
    } | null>(null);
    const [pvePaused, setPvePausedLocal] = useState(false);
    const [waveRunRecap, setWaveRunRecap] = useState<{
        kills: number;
        wave: number;
        bestKills: number;
        isNewBest: boolean;
        retryReady: boolean;
    } | null>(null);
    const [matchRecap, setMatchRecap] = useState<MatchRecapState | null>(null);
    const [rankedState, setRankedState] = useState<{
        season: {
            id: string;
            slug: string;
            starts_at: string;
            ends_at: string | null;
            status: string;
        } | null;
        rating: RankSnapshot | null;
        label: string | null;
    }>({ season: null, rating: null, label: null });
    const [rankedLeaderboard, setRankedLeaderboard] = useState<
        Array<{
            userId: string;
            displayName: string;
            mmr: number;
            lp: number;
            tier: string;
            division: number;
            rank: number;
        }>
    >([]);
    const [party, setParty] = useState<PartySnapshot | null>(null);
    const [partyInvite, setPartyInvite] = useState<{
        partyId: string;
        fromName: string;
        modes: string[];
    } | null>(null);
    const [nearInteract, setNearInteract] = useState<NearInteract>(null);
    const nearInteractRef = useRef<NearInteract>(null);
    const lastPortalAutoIdRef = useRef<string | null>(null);
    const [economy, setEconomy] = useState({
        copper: 0,
        silver: 0,
        gold: 0,
        essence: 0,
        rubies: 0,
        talentPoints: 0,
        talentBuild: {} as Record<string, number>,
        loadout: [] as string[],
        flexLoadout: EMPTY_FLEX_LOADOUT as FlexLoadout,
        talents: [] as string[],
        unlocks: null as import("@battlebeasts/shared").PlayerUnlocks | null,
        loadoutPresets: [] as Array<{
            slotIndex: number;
            name: string;
            abilityIds: string[];
            talentBuild?: Record<string, number>;
        }>,
        activeLoadoutSlot: 0,
    });
    const fxKeyRef = useRef(0);
    const dmgKeyRef = useRef(0);

    const seqRef = useRef(0);
    const keysRef = useRef({ up: false, down: false, left: false, right: false });
    /** Hold-to-cast for mouse slots (LMB / RMB). */
    const heldCastSlotsRef = useRef({ mouse0: false, mouse2: false });
    /** V-key emote pie wheel. */
    const [emotePieOpen, setEmotePieOpen] = useState(false);
    const emotePieOpenRef = useRef(false);
    const [emoteAimAngle, setEmoteAimAngle] = useState(0);
    const emoteAimAngleRef = useRef(0);
    const emoteSlotsRef = useRef<(string | null)[]>(emptyEmoteSlots());
    const yawRef = useRef(0);
    const roomRef = useRef<Room | null>(null);
    const clientRef = useRef<Client | null>(null);
    const predictorRef = useRef(new LocalPredictor());
    const predictedRef = useRef<PredictedPose>({ x: 0, z: 0, yaw: 0 });
    const pendingInteractRef = useRef<string | undefined>(undefined);
    const pendingCastRef = useRef<string | undefined>(undefined);
    const pendingCancelRef = useRef(false);
    /** Portal Space release — one-tick confirmCast. */
    const pendingConfirmRef = useRef(false);
    /** Space released during portal cast; confirm as soon as impact channel starts. */
    const portalConfirmArmedRef = useRef(false);
    /** performance.now when local portal impact channel began. */
    const portalChannelAnchorRef = useRef(0);
    /** Optimistic cancel — ignore stale schema cast slow until server clears. */
    const localCastCancelledRef = useRef(false);
    const awaitingCastAckRef = useRef(false);
    /** performance.now when awaitingCastAck became true — safety clear if server never acks. */
    const awaitingCastAckSinceRef = useRef(0);
    /**
     * Schema has shown castPhase for the current cast. combat_fx often arrives first;
     * until this flips true, an empty schema must not wipe optimistic / fx cast aim.
     */
    const schemaCastSeenRef = useRef(false);
    const castingAbilityRef = useRef<string | null>(null);
    const castPhaseRef = useRef<string>("");
    const cooldownUntilRef = useRef<Record<string, number>>({});
    const loadoutRef = useRef<string[]>([]);
    const flexLoadoutRef = useRef<FlexLoadout>(EMPTY_FLEX_LOADOUT);
    const castFlashTimerRef = useRef(0);
    const sessionIdRef = useRef<string | null>(null);
    const lastHudUpdate = useRef(0);
    const lastAckRef = useRef(-1);
    const inputLockedRef = useRef(Boolean(options.inputLocked));
    /** UI overlays / death — separate from PvP phase lock so we can recompute both. */
    const uiInputLockedRef = useRef(Boolean(options.inputLocked));
    const matchPauseRef = useRef<MatchPauseInfo>(null);
    const pvePausedRef = useRef(false);
    const activeUiRef = useRef<ActiveUi>(null);
    const transferringRef = useRef(false);
    const phaseRef = useRef<SessionPhase>("hub");
    const contentModeRef = useRef<string | null>(null);
    /**
     * NPCs in the map currently being played, cached off the mode.
     *
     * Recomputed only when the mode changes: the list comes from a static
     * document, so re-deriving it inside the input loop would parse the same
     * elements sixty times a second to get the same answer.
     */
    const npcsRef = useRef<NpcPlacement[]>([]);
    const reconnectingRef = useRef(false);
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const [localPlayer, setLocalPlayer] = useState<{ x: number; z: number } | null>(null);

    const closeNpcDialogue = useCallback(() => {
        setNpcDialogue(null);
        setTalkingNpc(null);
    }, []);

    const showToast = useCallback((message: string) => {
        setToast(message);
        window.setTimeout(() => setToast(null), 2500);
    }, []);

    /**
     * Server clears casts/CDs on death without a cast_phase cancel. If we keep
     * awaitingCastAck / castPhase / client CDs, casting stays locked after respawn.
     */
    const clearLocalCombatCastState = useCallback(() => {
        castPhaseRef.current = "";
        castingAbilityRef.current = null;
        castAimRuntime.clear();
        awaitingCastAckRef.current = false;
        awaitingCastAckSinceRef.current = 0;
        schemaCastSeenRef.current = false;
        localCastCancelledRef.current = false;
        pendingCastRef.current = undefined;
        pendingCancelRef.current = false;
        pendingConfirmRef.current = false;
        portalConfirmArmedRef.current = false;
        portalChannelAnchorRef.current = 0;
        heldCastSlotsRef.current = { mouse0: false, mouse2: false };
        cooldownUntilRef.current = {};
        abilityHudRuntime.clear();
        chargeHudRuntime.clear();
        window.clearTimeout(castFlashTimerRef.current);
        predictorRef.current.clearTravel();
        predictorRef.current.clearMoveMul();
    }, []);

    const applyTransferRef = useRef<(msg: TransferMsg) => Promise<void>>(async () => undefined);
    const tryContentReconnectRef = useRef<(code?: number) => Promise<boolean>>(async () => false);

    const persistRejoinToken = useCallback((joined: Room, mode: string | null) => {
        const token = (joined as Room & { reconnectionToken?: string }).reconnectionToken;
        if (!token) return;
        const opts = optionsRef.current;
        const hubOwnerId = opts.hubOwnerId ?? opts.userId;
        if (mode != null) {
            clearHubRejoin();
            saveContentRejoin({
                token,
                roomId: joined.roomId,
                mode,
                hubOwnerId,
            });
        } else {
            clearContentRejoin();
            saveHubRejoin({
                token,
                roomId: joined.roomId,
                hubOwnerId,
            });
        }
        if (opts.userId && hubOwnerId && hubOwnerId !== opts.userId) {
            savePreferredHub(opts.userId, hubOwnerId);
        }
    }, []);

    const wireRoom = useCallback(
        (joined: Room, nextPhase: SessionPhase, mode?: string | null) => {
            roomRef.current = joined;
            setRoom(joined);
            sessionIdRef.current = joined.sessionId;
            setStatus("connected");
            setPhase(nextPhase);
            phaseRef.current = nextPhase;
            setContentMode(mode ?? null);
            contentModeRef.current = mode ?? null;
            npcsRef.current = npcsForSession(nextPhase, mode ?? null);
            setActiveUi(null);
            // A conversation cannot survive the room it was started in.
            setNpcDialogue(null);
            setTalkingNpc(null);
            setMatchPause(null);
            setWaveHud(null);
            setPvePausedLocal(false);
            emotePieOpenRef.current = false;
            setEmotePieOpen(false);
            combatOverlayRuntime.clear();
            clearInteractPrompt();
            setNearInteract(null);
            nearInteractRef.current = null;
            lastPortalAutoIdRef.current = null;
            setMatchRecap(null);
            setWaveRunRecap(null);
            setPartyInvite(null);
            if (nextPhase === "hub") {
                setIsHubAdmin(false);
            } else {
                setHubRoster([]);
                setIsHubAdmin(false);
                adminNoCooldownRef.current = false;
                setAdminNoCooldownState(false);
                setIntroCompleted(null);
                setParty(null);
            }
            if (nextPhase !== "content") setArenaHud(null);
            predictorRef.current = new LocalPredictor();
            lastAckRef.current = -1;
            seqRef.current = 0;
            // Transfer must clear combat client state or casts stay locked forever.
            clearLocalCombatCastState();
            setDiedAt(null);
            setDeathAnimMs(3000);
            diedAtRef.current = null;
            deathSpectateRef.current = false;
            spectateTargetIdRef.current = null;
            setDeathSpectate(false);
            setSpectateTargetId(null);
            setCombatHudVisible(false);
            combatHudLingerUntilRef.current = 0;
            prevLocalHpRef.current = null;

            if (nextPhase === "content") {
                persistRejoinToken(joined, mode ?? null);
            } else {
                persistRejoinToken(joined, null);
            }

            joined.onMessage("toast", (msg: { message: string }) => {
                showToast(msg.message);
            });

            joined.onMessage("ui", (msg: { ui: Exclude<ActiveUi, null> }) => {
                setActiveUi(msg.ui);
            });

            joined.onMessage("npc_dialogue", (msg: NpcDialogueData) => {
                setNpcDialogue(msg);
                // Tells the villager in the scene to play its talk gesture.
                setTalkingNpc(msg.npcId);
            });

            joined.onMessage("queue_status", (msg: { queued: boolean; modes?: string[] }) => {
                if (msg.queued) {
                    setPhase("queued");
                    phaseRef.current = "queued";
                    setQueueModes(msg.modes ?? []);
                    // Close portal UI only — keep shop / loadout / etc. usable while searching.
                    setActiveUi((ui) =>
                        ui === "portal_pvp" || ui === "portal_pve" ? null : ui,
                    );
                } else {
                    setQueueModes([]);
                    setPhase((p) => {
                        const next = p === "queued" ? "hub" : p;
                        phaseRef.current = next;
                        return next;
                    });
                }
            });

            joined.onMessage("transfer", (msg: TransferMsg) => {
                void applyTransferRef.current(msg);
            });

            joined.onMessage(
                "inventory",
                (msg: {
                    resources?: Record<string, number>;
                    loadout?: string[];
                    flexLoadout?: (string | null)[];
                    talents?: string[];
                    talentBuild?: Record<string, number>;
                    unlocks?: import("@battlebeasts/shared").PlayerUnlocks;
                    loadoutPresets?: Array<{
                        slotIndex: number;
                        name: string;
                        abilityIds: string[];
                        talentBuild?: Record<string, number>;
                    }>;
                    activeLoadoutSlot?: number;
                }) => {
                    setEconomy({
                        copper: msg.resources?.copper ?? 0,
                        silver: msg.resources?.silver ?? 0,
                        gold: msg.resources?.gold ?? 0,
                        essence: msg.resources?.essence ?? 0,
                        rubies: msg.resources?.rubies ?? 0,
                        talentPoints: msg.resources?.talent_points ?? 0,
                        talentBuild: msg.talentBuild ?? {},
                        loadout: msg.loadout ?? [],
                        flexLoadout: normalizeFlexLoadout(msg.flexLoadout),
                        talents: msg.talents ?? [],
                        unlocks: msg.unlocks ?? null,
                        loadoutPresets: msg.loadoutPresets ?? [],
                        activeLoadoutSlot: msg.activeLoadoutSlot ?? 0,
                    });
                },
            );

            joined.onMessage(
                "match_pause",
                (msg: {
                    reason: "pvp_reconnect" | "pve_reconnect" | "resume_grace";
                    until: number;
                    playerName?: string;
                }) => {
                    setMatchPause({
                        reason: msg.reason,
                        until: msg.until,
                        playerName: msg.playerName,
                    });
                },
            );

            joined.onMessage("match_resume", () => {
                setMatchPause(null);
            });

            joined.onMessage(
                "wave_hud",
                (msg: { wave?: number; phase?: string; alive?: number; goal?: number }) => {
                    setWaveHud({
                        wave: Math.max(0, Math.floor(Number(msg.wave) || 0)),
                        phase: typeof msg.phase === "string" ? msg.phase : "idle",
                        alive: Math.max(0, Math.floor(Number(msg.alive) || 0)),
                        goal: Math.max(0, Math.floor(Number(msg.goal) || 0)),
                    });
                },
            );
            joined.onMessage("pve_pause", (msg: { paused?: boolean }) => {
                setPvePausedLocal(Boolean(msg?.paused));
            });
            joined.onMessage(
                "pve_run_end",
                (msg: { kills?: number; wave?: number }) => {
                    const kills = Math.max(0, Math.floor(Number(msg.kills) || 0));
                    const wave = Math.max(0, Math.floor(Number(msg.wave) || 0));
                    const { best, isNewBest } = recordWaveBestRun(optionsRef.current.userId, {
                        kills,
                        wave,
                    });
                    setWaveRunRecap({
                        kills,
                        wave,
                        bestKills: best.kills,
                        isNewBest,
                        retryReady: false,
                    });
                    setDiedAt(null);
                    setPvePausedLocal(true);
                },
            );
            joined.onMessage("pve_run_restart", () => {
                setWaveRunRecap(null);
                setWaveHud(null);
                setDiedAt(null);
                setPvePausedLocal(false);
                clearLocalCombatCastStateRef.current();
            });

            joined.onMessage("hub_roster", (msg: { players?: HubRosterPlayer[] }) => {
                setHubRoster(Array.isArray(msg.players) ? msg.players : []);
            });
            joined.onMessage("hub_you_are_admin", (msg: { admin?: boolean }) => {
                setIsHubAdmin(Boolean(msg?.admin));
            });
            joined.onMessage("hub_admin_no_cooldown", (msg: { enabled?: boolean }) => {
                const on = Boolean(msg?.enabled);
                adminNoCooldownRef.current = on;
                setAdminNoCooldownState(on);
                if (on) {
                    cooldownUntilRef.current = {};
                    abilityHudRuntime.setCooldownUntil({});
                }
            });
            joined.onMessage(
                "hub_intro_status",
                (msg: { completed?: boolean; replay?: boolean }) => {
                    setIntroCompleted(Boolean(msg?.completed));
                    if (msg?.replay && msg.completed === false) {
                        setIntroReplayToken((n) => n + 1);
                    }
                },
            );
            joined.onMessage(
                "hub_intro_posed",
                (msg: { x?: number; z?: number; yaw?: number }) => {
                    if (
                        typeof msg?.x !== "number" ||
                        typeof msg?.z !== "number" ||
                        typeof msg?.yaw !== "number"
                    ) {
                        return;
                    }
                    predictorRef.current.seed(msg.x, msg.z, msg.yaw);
                    predictedRef.current = { x: msg.x, z: msg.z, yaw: msg.yaw };
                    yawRef.current = msg.yaw;
                },
            );
            joined.onMessage("hub_grant_result", (msg: { ok?: boolean; error?: string }) => {
                if (msg?.ok === false && msg.error) {
                    // toast already sent from server for success; surface auth errors
                    console.warn("[hub_grant]", msg.error);
                }
            });
            joined.onMessage(
                "hub_quests_state",
                (msg: {
                    quests?: Array<{
                        id: string;
                        label: string;
                        type: string;
                        target: number;
                        chest: string;
                        progress: number;
                        completed: boolean;
                    }>;
                    chests?: Array<{
                        id: string;
                        quality: string;
                        source: string;
                        created_at?: string;
                    }>;
                }) => {
                    const nextQuests = Array.isArray(msg.quests) ? msg.quests : [];
                    const nextChests = Array.isArray(msg.chests) ? msg.chests : [];
                    const hydrated = questsHydratedRef.current;

                    if (!hydrated) {
                        for (const q of nextQuests) {
                            if (q.completed) seenQuestCompletionsRef.current.add(q.id);
                        }
                        knownChestIdsRef.current = new Set(nextChests.map((c) => c.id));
                        questsHydratedRef.current = true;
                    } else {
                        let newCompletions = 0;
                        for (const q of nextQuests) {
                            if (!q.completed) continue;
                            if (seenQuestCompletionsRef.current.has(q.id)) continue;
                            seenQuestCompletionsRef.current.add(q.id);
                            newCompletions += 1;
                            showToast(`Quest complete: ${q.label}`);
                        }
                        if (newCompletions > 0) {
                            setUnseenQuestCompletions((n) => n + newCompletions);
                        }

                        let newChests = 0;
                        const nextChestIds = new Set(nextChests.map((c) => c.id));
                        for (const id of nextChestIds) {
                            if (!knownChestIdsRef.current.has(id)) newChests += 1;
                        }
                        knownChestIdsRef.current = nextChestIds;
                        if (newChests > 0) {
                            showToast(
                                newChests === 1
                                    ? "You received a chest"
                                    : `You received ${newChests} chests`,
                            );
                        }
                    }

                    setHubQuests(nextQuests);
                    setHubChests(nextChests);
                },
            );
            joined.onMessage(
                "hub_chest_opened",
                (msg: {
                    ok?: boolean;
                    quality?: string;
                    essence?: number;
                    copper?: number;
                    lines?: import("@battlebeasts/shared").ChestLootLine[];
                }) => {
                    setPendingChestOpenId(null);
                    if (!msg?.ok) {
                        setChestReveal(null);
                        return;
                    }
                    setChestReveal((prev) => ({
                        quality: msg.quality ?? prev?.quality ?? "green",
                        essence: msg.essence ?? 0,
                        copper: msg.copper ?? 0,
                        lines: Array.isArray(msg.lines) ? msg.lines : [],
                        awaitingLoot: false,
                    }));
                },
            );

            joined.onMessage(
                "emote_fx",
                (msg: { sessionId: string; emoteId: string; phase: "start" | "cancel" }) => {
                    if (!msg?.sessionId) return;
                    if (msg.phase === "start" && msg.emoteId) {
                        const def = getEmote(msg.emoteId);
                        if (def) setActiveEmote(msg.sessionId, msg.emoteId, def.durationMs);
                    } else {
                        clearActiveEmote(msg.sessionId);
                    }
                },
            );

            joined.onMessage("party_update", (msg: { party?: PartySnapshot | null }) => {
                const next = msg.party ?? null;
                setParty((prev) => {
                    if (!prev && next) setActiveUi("party_lobby");
                    if (prev && !next) setActiveUi((ui) => (ui === "party_lobby" ? null : ui));
                    return next;
                });
                if (next?.queued) setPartyInvite(null);
            });

            joined.onMessage(
                "party_invite",
                (msg: { partyId: string; fromName: string; modes?: string[] }) => {
                    if (!msg?.partyId) return;
                    setPartyInvite({
                        partyId: msg.partyId,
                        fromName: msg.fromName ?? "A hunter",
                        modes: msg.modes ?? [],
                    });
                },
            );

            joined.onMessage(
                "match_recap",
                (msg: {
                    winner: "a" | "b" | "c" | "draw";
                    scoreA: number;
                    scoreB: number;
                    scoreC?: number;
                    matchKind?: "ranked" | "custom";
                    rows: MatchRecapRow[];
                }) => {
                    setMatchRecap({
                        winner: msg.winner,
                        scoreA: msg.scoreA,
                        scoreB: msg.scoreB,
                        scoreC: msg.scoreC,
                        matchKind: msg.matchKind,
                        rows: msg.rows ?? [],
                    });
                },
            );

            joined.onMessage("hub_ranked_state", (msg: {
                season: {
                    id: string;
                    slug: string;
                    starts_at: string;
                    ends_at: string | null;
                    status: string;
                } | null;
                rating: RankSnapshot | null;
                label: string | null;
            }) => {
                const rating = msg.rating ? normalizeRankSnapshot(msg.rating) : null;
                setRankedState({
                    season: msg.season,
                    rating,
                    label: rating ? formatRankLabel(rating) : msg.label,
                });
            });

            joined.onMessage(
                "hub_ranked_leaderboard",
                (msg: {
                    rows: Array<{
                        userId: string;
                        displayName: string;
                        mmr: number;
                        lp: number;
                        tier: string;
                        division: number;
                        rank: number;
                    }>;
                }) => {
                    setRankedLeaderboard(msg.rows ?? []);
                },
            );

            joined.onMessage(
                "combat_fx",
                (msg: {
                    kind: "aoe" | "melee" | "dash" | "hit" | "cast_phase" | "portal";
                    abilityId: string;
                    x: number;
                    z: number;
                    y?: number;
                    x2?: number;
                    z2?: number;
                    radius?: number;
                    yaw?: number;
                    ownerId?: string;
                    targetId?: string;
                    damage?: number;
                    crit?: boolean;
                    phase?: "anticipation" | "cast" | "impact" | "recovery" | "cancel" | "interrupt" | "idle";
                    phaseEndsAt?: number;
                    cooldownMs?: number;
                    comboHit?: number;
                }) => {
                    const isLocal = msg.ownerId === sessionIdRef.current;

                    if (msg.kind === "portal") {
                        if (msg.abilityId === "teleportSlam") {
                            // Character fades; soft earth dust at depart + arrive (no white sphere).
                            if (msg.ownerId) beginTeleportSlamFadeIn(msg.ownerId);
                            spawnImpactEffect(
                                "teleportSlam",
                                { x: msg.x, z: msg.z, y: 0.04, yaw: msg.yaw },
                                { lifeMs: 380, variant: 2 },
                            );
                            spawnImpactEffect(
                                "teleportSlam",
                                {
                                    x: msg.x2 ?? msg.x,
                                    z: msg.z2 ?? msg.z,
                                    y: 0.04,
                                    yaw: msg.yaw,
                                },
                                { lifeMs: 580, variant: 1 },
                            );
                            if (isLocal) {
                                const toX = msg.x2 ?? msg.x;
                                const toZ = msg.z2 ?? msg.z;
                                predictorRef.current.seed(
                                    toX,
                                    toZ,
                                    typeof msg.yaw === "number"
                                        ? msg.yaw
                                        : predictedRef.current.yaw,
                                );
                                predictedRef.current = { ...predictorRef.current.state };
                            }
                            if (
                                isLocal &&
                                typeof msg.cooldownMs === "number" &&
                                !adminNoCooldownRef.current
                            ) {
                                const until = Date.now() + msg.cooldownMs;
                                cooldownUntilRef.current = {
                                    ...cooldownUntilRef.current,
                                    [msg.abilityId]: until,
                                };
                                abilityHudRuntime.setCooldownUntil(cooldownUntilRef.current);
                            }
                            return;
                        }
                        // Depart: collapse the channel bubble (size from live channel scale)
                        const departScale = msg.ownerId
                            ? takePortalChannelBubbleScale(msg.ownerId)
                            : 1;
                        spawnImpactEffect(
                            "portal",
                            { x: msg.x, z: msg.z, y: 0.95, yaw: msg.yaw },
                            { lifeMs: 340, variant: 0, radius: departScale },
                        );
                        // Arrive: ground rings grow + fade
                        spawnImpactEffect(
                            "portal",
                            { x: msg.x2 ?? msg.x, z: msg.z2 ?? msg.z, y: 0.05, yaw: msg.yaw },
                            { lifeMs: 300, variant: 1 },
                        );
                        if (isLocal && msg.abilityId === "riftFissure") {
                            // x2/z2 is the opposite-side exit (post-shove). Snap — don't lerp from entry.
                            const toX = msg.x2 ?? msg.x;
                            const toZ = msg.z2 ?? msg.z;
                            predictorRef.current.seed(toX, toZ, predictedRef.current.yaw);
                            predictedRef.current = { ...predictorRef.current.state };
                        }
                        if (
                            isLocal &&
                            typeof msg.cooldownMs === "number" &&
                            !adminNoCooldownRef.current
                        ) {
                            const until = Date.now() + msg.cooldownMs;
                            cooldownUntilRef.current = {
                                ...cooldownUntilRef.current,
                                [msg.abilityId]: until,
                            };
                            abilityHudRuntime.setCooldownUntil(cooldownUntilRef.current);
                        }
                        return;
                    }

                    if (
                        msg.kind === "dash" &&
                        isLocal &&
                        (msg.abilityId === "spiritForm" ||
                            msg.abilityId === "verdantLeap" ||
                            msg.abilityId === "bulwarkCharge" ||
                            msg.abilityId === "predatorStep" ||
                            msg.abilityId === "rebound")
                    ) {
                        const landX = msg.x2 ?? msg.x;
                        const landZ = msg.z2 ?? msg.z;
                        const dur =
                            typeof msg.phaseEndsAt === "number"
                                ? Math.max(16, msg.phaseEndsAt - Date.now())
                                : 280;
                        predictorRef.current.beginPointTravel(landX, landZ, dur, {
                            ignoreCollision: msg.abilityId === "spiritForm",
                            abilityId: msg.abilityId,
                        });
                        predictedRef.current = { ...predictorRef.current.state };
                        awaitingCastAckRef.current = false;
                        pendingCastRef.current = undefined;
                        castPhaseRef.current = "";
                        castingAbilityRef.current = null;
                        schemaCastSeenRef.current = false;
                        castAimRuntime.clear();
                        predictorRef.current.clearMoveMul();
                    }

                    if (
                        msg.abilityId === "revenge" &&
                        msg.ownerId &&
                        (msg.kind === "dash" || msg.kind === "hit")
                    ) {
                        beginRevengeVanish(msg.ownerId);
                    }

                        if (msg.kind === "cast_phase") {
                        if (
                            (msg.phase === "cancel" || msg.phase === "interrupt") &&
                            msg.ownerId
                        ) {
                            if (msg.abilityId === "iceLance") {
                                // Only the active cast — keep prior fuse plants flying/stuck.
                                cancelActiveCastHandle(msg.ownerId, "iceLance");
                            } else if (
                                usesFrostMistFx(msg.abilityId) ||
                                usesGrooveFx(msg.abilityId) ||
                                usesHealBeamFx(msg.abilityId) ||
                                usesLifeLeechFx(msg.abilityId)
                            ) {
                                cancelFollowOwnerVfx(msg.abilityId, msg.ownerId);
                            } else if (msg.abilityId === "fireball") {
                                // Handle may already be detached when schema hits "";
                                // still kill the follow-owner charge mesh.
                                cancelActiveCastHandle(msg.ownerId, "fireball");
                                cancelFollowOwnerVfx("fireball", msg.ownerId);
                            }
                        }
                        if (
                            msg.abilityId === "teleportSlam" &&
                            msg.phase === "impact" &&
                            msg.ownerId
                        ) {
                            beginTeleportSlamFadeOut(msg.ownerId);
                        }
                        if (isLocal) {
                            awaitingCastAckRef.current = false;
                            awaitingCastAckSinceRef.current = 0;
                            const ended =
                                msg.phase === "idle" ||
                                msg.phase === "cancel" ||
                                msg.phase === "interrupt";
                            // Keep localCastCancelled until schema clears — combat_fx often
                            // arrives first; clearing the flag early lets stale castPhase
                            // re-apply cast slow and stick after cancel.
                            castPhaseRef.current = ended ? "" : (msg.phase ?? "");
                            castingAbilityRef.current = ended ? null : msg.abilityId;
                            if (ended || msg.phase === "cancel" || msg.phase === "interrupt") {
                                schemaCastSeenRef.current = false;
                                castAimRuntime.clear();
                            } else if (msg.abilityId === "shrooms" && msg.phase !== "anticipation") {
                                // Real plant starts — drop the aim ghost.
                                castAimRuntime.clear();
                            } else if (msg.abilityId === "lifeLeech" && msg.phase === "impact") {
                                // Beam particles take over — drop the aim ghost.
                                castAimRuntime.clear();
                            } else {
                                castAimRuntime.set(
                                    castingAbilityRef.current,
                                    castPhaseRef.current,
                                    msg.comboHit || 1,
                                );
                            }

                            if (ended) {
                                predictorRef.current.clearTravel();
                                portalChannelAnchorRef.current = 0;
                                portalConfirmArmedRef.current = false;
                                // Mirror server: CD → full speed; idle mid-chain → continue slow; else clear
                                if (typeof msg.cooldownMs === "number") {
                                    predictorRef.current.clearMoveMul();
                                } else if (msg.phase === "idle" && ABILITIES[msg.abilityId]?.combo) {
                                    predictorRef.current.applyComboContinue(msg.abilityId);
                                } else {
                                    predictorRef.current.clearMoveMul();
                                }
                            } else if (msg.phase && !localCastCancelledRef.current) {
                                predictorRef.current.applyCastMove(msg.abilityId, msg.phase);
                            }

                            // Effect + travel at impact; CD only when server says so
                            // (combo mid-chain impacts omit cooldownMs).
                            // Confirm-on-release (Portal) waits for Space release — no snap here.
                            if (msg.phase === "impact") {
                                const def = ABILITIES[msg.abilityId];
                                if (def?.confirmOnRelease) {
                                    portalChannelAnchorRef.current = performance.now();
                                    // Released during windup — confirm as soon as impact opens.
                                    if (portalConfirmArmedRef.current) {
                                        if (msg.abilityId === "portal") {
                                            const dist = channelChargeDistance(def, 0);
                                            predictorRef.current.beginInstantBlink(
                                                msg.abilityId,
                                                yawRef.current,
                                                dist,
                                            );
                                        }
                                        portalChannelAnchorRef.current =
                                            msg.abilityId === "portal" ? 0 : portalChannelAnchorRef.current;
                                        pendingConfirmRef.current = true;
                                        portalConfirmArmedRef.current = false;
                                    }
                                } else if (def) {
                                    predictorRef.current.beginTravelFromCast(
                                        msg.abilityId,
                                        yawRef.current,
                                    );
                                }
                            }
                            if (msg.phase === "recovery" && ABILITIES[msg.abilityId]?.confirmOnRelease) {
                                portalChannelAnchorRef.current = 0;
                                portalConfirmArmedRef.current = false;
                            }
                            if (msg.abilityId === "fireball") {
                                if (msg.phase === "impact") {
                                    const fb = ABILITIES.fireball;
                                    castBarRuntime.begin({
                                        abilityId: "fireball",
                                        name: fb?.name ?? "Fireball",
                                        mode: "charge",
                                        durationMs: fireballChargeWindowWallMs(),
                                        holdMs: 0,
                                        interruptible: true,
                                    });
                                } else if (
                                    msg.phase === "anticipation" ||
                                    msg.phase === "cast"
                                ) {
                                    // Wait for impact (ball appear) before filling.
                                    castBarRuntime.clear();
                                } else {
                                    castBarRuntime.clear();
                                }
                            } else if (msg.phase === "impact") {
                                const chDef = ABILITIES[msg.abilityId];
                                if (chDef && castBarShowsChannel(chDef)) {
                                    castBarRuntime.begin({
                                        abilityId: msg.abilityId,
                                        name: chDef.name,
                                        mode: "channel",
                                        durationMs: Math.max(
                                            400,
                                            phaseDurationMs(chDef, "impact"),
                                        ),
                                        interruptible: chDef.timing.cancelUntilPhase === "impact",
                                    });
                                } else {
                                    // Windup finished — hide bar when the spell commits.
                                    castBarRuntime.clear();
                                }
                            } else if (
                                msg.phase === "recovery" ||
                                msg.phase === "idle" ||
                                msg.phase === "cancel" ||
                                msg.phase === "interrupt"
                            ) {
                                castBarRuntime.clear();
                            }
                            if (
                                typeof msg.cooldownMs === "number" &&
                                !adminNoCooldownRef.current
                            ) {
                                const until = Date.now() + msg.cooldownMs;
                                cooldownUntilRef.current = {
                                    ...cooldownUntilRef.current,
                                    [msg.abilityId]: until,
                                };
                                abilityHudRuntime.setCooldownUntil(cooldownUntilRef.current);
                            }
                        }
                        return;
                    }

                    dispatchCombatFxVfx(msg, {
                        localSessionId: sessionIdRef.current,
                        localYaw: yawRef.current,
                        predicted: predictedRef.current,
                        getOwner: (ownerId) =>
                            joined.state?.players?.get(ownerId) as
                                | { x?: number; z?: number; yaw?: number }
                                | undefined,
                        pushBurst: (burst) => combatOverlayRuntime.pushBurst(burst),
                        nextFxKey: () => ++fxKeyRef.current,
                        fxColors: FX_COLORS,
                    });

                    if (msg.kind === "hit" && typeof msg.damage === "number" && msg.damage > 0) {
                        // Don't reveal cloaked hunters to others via floating damage.
                        const targetId = msg.targetId;
                        const localId = sessionIdRef.current;
                        if (targetId && targetId !== localId && joined.state?.players) {
                            const target = joined.state.players.get(targetId) as
                                | { statuses?: Parameters<typeof hasStatusId>[0] }
                                | undefined;
                            if (
                                hasStatusId(target?.statuses, "cloaked") ||
                                hasStatusId(target?.statuses, "revengePhased")
                            ) {
                                return;
                            }
                        }
                        const key = ++dmgKeyRef.current;
                        const ang = Math.random() * Math.PI * 2;
                        const isHeal =
                            usesGrooveFx(msg.abilityId) ||
                            usesHealBeamFx(msg.abilityId) ||
                            getStatus(msg.abilityId)?.mechanic === "hot" ||
                            (ABILITIES[msg.abilityId]?.heal ?? 0) > 0 ||
                            // Life Leech: self-restore hits are heals; enemy hits stay damage.
                            (usesLifeLeechFx(msg.abilityId) &&
                                !!msg.ownerId &&
                                msg.targetId === msg.ownerId);
                        const popup: DamagePopup = {
                            key,
                            amount: msg.damage,
                            kind: isHeal ? "heal" : "damage",
                            crit: msg.crit === true,
                            x: msg.x,
                            z: msg.z,
                            y: 1.35 + Math.random() * 0.25,
                            born: performance.now(),
                            life: DAMAGE_POPUP_LIFE_MS,
                            driftX: Math.cos(ang) * (0.35 + Math.random() * 0.45),
                            driftZ: Math.sin(ang) * (0.35 + Math.random() * 0.45),
                        };
                        combatOverlayRuntime.pushPopup(popup);
                    }
                },
            );

            // Backup: schema patch also clears UI if match_resume was missed
            const state = joined.state as {
                listen?: (key: string, cb: (value: unknown) => void) => void;
                paused?: boolean;
                pauseReason?: string;
                reconnectUntil?: number;
            };
            const syncPauseFromState = (s: typeof state) => {
                const reason = s.pauseReason;
                if (reason === "pvp_reconnect" || reason === "pve_reconnect" || reason === "resume_grace") {
                    setMatchPause({
                        reason,
                        until: s.reconnectUntil ?? 0,
                    });
                }
            };
            state.listen?.("paused", (paused) => {
                if (!paused) {
                    setMatchPause(null);
                    setPvePausedLocal(false);
                    return;
                }
                syncPauseFromState(state);
                setPvePausedLocal(state.pauseReason === "pve_manual");
            });
            state.listen?.("pauseReason", () => {
                if (state.paused) syncPauseFromState(state);
                setPvePausedLocal(Boolean(state.paused) && state.pauseReason === "pve_manual");
            });
            state.listen?.("reconnectUntil", () => {
                if (state.paused) syncPauseFromState(state);
            });

            joined.onMessage("match_forfeit", (msg: { playerName: string }) => {
                showToast(`${msg.playerName} forfeited`);
            });

            joined.onMessage("match_rebalance", (msg: { remaining: number; playerName?: string }) => {
                showToast(
                    msg.playerName
                        ? `Rebalanced after ${msg.playerName} left (${msg.remaining} left)`
                        : `Party rebalanced (${msg.remaining} left)`,
                );
            });

            joined.onLeave((code) => {
                clearCrescentSpawnState();
                predictorRef.current.clearMoveMul();
                predictorRef.current.clearTravel();
                if (transferringRef.current || reconnectingRef.current) return;
                if (phaseRef.current === "content" && code !== 1000) {
                    void tryContentReconnectRef.current(code).then((ok) => {
                        if (!ok) {
                            setStatus("disconnected");
                            setRoom(null);
                            roomRef.current = null;
                            setMatchPause(null);
                        }
                    });
                    return;
                }
                setStatus("disconnected");
                setRoom(null);
                roomRef.current = null;
                setMatchPause(null);
                if (phaseRef.current !== "content") clearContentRejoin();
            });
        },
        [persistRejoinToken, showToast, clearLocalCombatCastState],
    );

    const tryContentReconnect = useCallback(
        async (_code?: number) => {
            const client = clientRef.current;
            const saved = loadContentRejoin();
            if (!client || !saved?.token || reconnectingRef.current) return false;

            reconnectingRef.current = true;
            setStatus("connecting");
            showToast("Reconnecting to match…");
            try {
                const rejoined = await withTimeout(
                    client.reconnect(saved.token),
                    ROOM_CONNECT_TIMEOUT_MS,
                    "content reconnect",
                );
                wireRoom(rejoined, "content", saved.mode);
                showToast("Back in match");
                return true;
            } catch (err) {
                console.warn("content reconnect failed", err);
                clearContentRejoin();
                showToast("Could not reconnect — returning to city");
                try {
                    const opts = optionsRef.current;
                    const hub = await withTimeout(
                        client.joinOrCreate(ROOM.BASE_CITY, {
                            userId: opts.userId,
                            displayName: opts.displayName,
                            color: opts.color,
                            accessToken: opts.accessToken ?? undefined,
                            hubOwnerId: saved.hubOwnerId || opts.hubOwnerId || opts.userId,
                        }),
                        ROOM_CONNECT_TIMEOUT_MS,
                        "hub join after content fail",
                    );
                    wireRoom(hub, "hub", null);
                    return true;
                } catch (hubErr) {
                    console.error(hubErr);
                    setStatus("error");
                    return false;
                }
            } finally {
                reconnectingRef.current = false;
            }
        },
        [showToast, wireRoom],
    );
    tryContentReconnectRef.current = tryContentReconnect;

    const applyTransfer = useCallback(
        async (msg: TransferMsg) => {
            const opts = optionsRef.current;
            const client = clientRef.current;
            if (!client || !msg?.room) return;

            transferringRef.current = true;
            try {
                clearHubRejoin();
                clearContentRejoin();
                await roomRef.current?.leave(true);
                roomRef.current = null;
                setRoom(null);

                const hubOwnerId =
                    (msg.options?.hubOwnerId as string | undefined) ?? opts.hubOwnerId ?? opts.userId;

                const localPlayer = roomRef.current?.state?.players?.get(
                    roomRef.current.sessionId,
                ) as
                    | {
                        pattern?: string;
                        patternColor?: string;
                        cosmeticHat?: string;
                        cosmeticShoulders?: string;
                        cosmeticChest?: string;
                        cosmeticGloves?: string;
                        cosmeticBelt?: string;
                        cosmeticLegs?: string;
                        cosmeticShoes?: string;
                    }
                    | undefined;

                const joinOpts: Record<string, unknown> = {
                    userId: opts.userId,
                    displayName: opts.displayName,
                    color: opts.color,
                    pattern: localPlayer?.pattern,
                    patternColor: localPlayer?.patternColor,
                    cosmeticHat: localPlayer?.cosmeticHat,
                    cosmeticShoulders: localPlayer?.cosmeticShoulders,
                    cosmeticChest: localPlayer?.cosmeticChest,
                    cosmeticGloves: localPlayer?.cosmeticGloves,
                    cosmeticBelt: localPlayer?.cosmeticBelt,
                    cosmeticLegs: localPlayer?.cosmeticLegs,
                    cosmeticShoes: localPlayer?.cosmeticShoes,
                    accessToken: opts.accessToken ?? undefined,
                    hubOwnerId,
                    mode: msg.options?.mode,
                    modifiers: msg.options?.modifiers,
                    matchId: msg.options?.matchId,
                    team: msg.options?.team,
                    role: msg.options?.role,
                    spawnSlot: (() => {
                        const n = Number(msg.options?.spawnSlot);
                        return Number.isFinite(n) ? Math.floor(n) : undefined;
                    })(),
                };

                const joined = msg.roomId
                    ? await withTimeout(
                          client.joinById(msg.roomId, joinOpts),
                          ROOM_CONNECT_TIMEOUT_MS,
                          "transfer joinById",
                      )
                    : await withTimeout(
                          client.joinOrCreate(msg.room, joinOpts),
                          ROOM_CONNECT_TIMEOUT_MS,
                          "transfer joinOrCreate",
                      );
                const nextPhase: SessionPhase = msg.room === ROOM.BASE_CITY ? "hub" : "content";
                const mode = typeof msg.options?.mode === "string" ? msg.options.mode : null;
                wireRoom(joined, nextPhase, mode);
                if (nextPhase === "hub") {
                    setQueueModes([]);
                    setMatchRecap(null);
                    setArenaHud(null);
                    clearContentRejoin();
                    const ownId = opts.userId;
                    if (hubOwnerId && ownId && hubOwnerId !== ownId) {
                        savePreferredHub(ownId, hubOwnerId);
                        optionsRef.current.onActiveHubOwnerId?.(hubOwnerId);
                    } else {
                        clearPreferredHub();
                        optionsRef.current.onActiveHubOwnerId?.(null);
                    }
                    // Pull fresh ladder after ranked games so My rank isn't stale.
                    joined.send("hub_ranked_request");
                    joined.send("hub_ranked_leaderboard");
                    showToast("Returned to base city");
                } else {
                    showToast(`Transferred to ${mode ?? msg.room}`);
                }
            } catch (err) {
                console.error(err);
                setStatus("error");
                showToast("Transfer failed");
            } finally {
                transferringRef.current = false;
            }
        },
        [showToast, wireRoom],
    );
    applyTransferRef.current = applyTransfer;

    useEffect(() => {
        // Arena death / round-end still allows emotes (V-wheel). Don't hard-lock keys on diedAt in content.
        const deathLocksInput = diedAt != null && phase !== "content";
        const uiLocked =
            Boolean(options.inputLocked) ||
            activeUi !== null ||
            npcDialogue !== null ||
            Boolean(matchPause) ||
            Boolean(pvePaused) ||
            Boolean(partyInvite) ||
            deathLocksInput;
        uiInputLockedRef.current = uiLocked;
        inputLockedRef.current = uiLocked;
        activeUiRef.current = activeUi;
        matchPauseRef.current = matchPause;
        pvePausedRef.current = pvePaused;
        diedAtRef.current = diedAt;
        if (uiLocked) {
            keysRef.current = { up: false, down: false, left: false, right: false };
            heldCastSlotsRef.current = { mouse0: false, mouse2: false };
            pendingCastRef.current = undefined;
            if (emotePieOpenRef.current) {
                emotePieOpenRef.current = false;
                setEmotePieOpen(false);
            }
        }
        // Death (and any full input lock from it) must drop optimistic cast lock.
        if (diedAt != null) {
            clearLocalCombatCastState();
        } else if (deathSpectateRef.current) {
            deathSpectateRef.current = false;
            spectateTargetIdRef.current = null;
            setDeathSpectate(false);
            setSpectateTargetId(null);
        }
    }, [
        options.inputLocked,
        activeUi,
        npcDialogue,
        matchPause,
        pvePaused,
        partyInvite,
        diedAt,
        phase,
        clearLocalCombatCastState,
    ]);

    useEffect(() => {
        loadoutRef.current = normalizeLoadout(economy.loadout);
    }, [economy.loadout]);

    useEffect(() => {
        flexLoadoutRef.current = normalizeFlexLoadout(economy.flexLoadout);
    }, [economy.flexLoadout]);

    /** Optimistic spell-bar update while set_loadout round-trips (schema/inventory confirm or revert). */
    const applyLoadoutLocal = useCallback((abilityIds: string[]) => {
        const cleaned = normalizeLoadout(abilityIds);
        loadoutRef.current = cleaned;
        setEconomy((prev) => {
            if (prev.loadout.join(",") === cleaned.join(",")) return prev;
            return { ...prev, loadout: cleaned };
        });
    }, []);

    useEffect(() => {
        emoteSlotsRef.current = economy.unlocks?.emoteSlots ?? emptyEmoteSlots();
    }, [economy.unlocks]);

    const queueCastAbility = useCallback((abilityId: string | null | undefined) => {
        if (inputLockedRef.current) return;
        if (!abilityId) return;
        const def = ABILITIES[abilityId];
        if (!def) return;
        const now = Date.now();
        const room = roomRef.current;
        const me = room?.state?.players?.get(room.sessionId) as
            | { statuses?: Parameters<typeof hasStatusId>[0]; role?: string }
            | undefined;
        if (me?.role === "spectator") return;
        const spiritRecast =
            abilityId === "spiritForm" && hasStatusId(me?.statuses, "spiritFormed");
        const runicVolleyActive =
            abilityId === "runicShard" &&
            (() => {
                const projectiles = room?.state?.projectiles as
                    | Map<string, { ownerSessionId?: string; abilityId?: string; mode?: string }>
                    | { forEach: (cb: (raw: { ownerSessionId?: string; abilityId?: string; mode?: string }) => void) => void }
                    | undefined;
                if (!projectiles || !room?.sessionId) return false;
                let found = false;
                const visit = (raw: { ownerSessionId?: string; abilityId?: string; mode?: string }) => {
                    if (raw.ownerSessionId !== room.sessionId) return;
                    if (raw.abilityId !== "runicShard") return;
                    found = true;
                };
                if (typeof (projectiles as Map<string, unknown>).forEach === "function") {
                    (projectiles as { forEach: (cb: (raw: { ownerSessionId?: string; abilityId?: string; mode?: string }) => void) => void }).forEach(visit);
                }
                return found;
            })();
        // Runic Shard: LMB while own main shard is flying → shatter (no cast anim / CD gate).
        const runicShatter =
            abilityId === "runicShard" &&
            runicVolleyActive &&
            (() => {
                const projectiles = room?.state?.projectiles as
                    | { forEach: (cb: (raw: { ownerSessionId?: string; abilityId?: string; mode?: string }) => void) => void }
                    | undefined;
                if (!projectiles || !room?.sessionId) return false;
                let found = false;
                projectiles.forEach((raw) => {
                    if (raw.ownerSessionId !== room.sessionId) return;
                    if (raw.abilityId !== "runicShard") return;
                    if (raw.mode === "fragment") return;
                    found = true;
                });
                return found;
            })();
        // Block a fresh throw while any prior shard / fragment is still live.
        if (abilityId === "runicShard" && runicVolleyActive && !runicShatter) {
            return;
        }
        // Rift Fissure: CD starts on portal A; second plant is allowed while arming.
        const riftArmingRecast =
            abilityId === "riftFissure" &&
            (() => {
                const portals = room?.state?.riftPortals as
                    | { forEach: (cb: (raw: { ownerSessionId?: string; phase?: string; armEndsAt?: number; index?: number }) => void) => void }
                    | undefined;
                if (!portals || !room?.sessionId) return false;
                let arming = false;
                portals.forEach((raw) => {
                    if (raw.ownerSessionId !== room.sessionId) return;
                    if (raw.phase !== "arming") return;
                    if ((raw.index ?? 0) !== 0) return;
                    if ((raw.armEndsAt ?? 0) > now) arming = true;
                });
                return arming;
            })();
        // Spirit Form / Rift second plant / Runic shatter while CD is already ticking — don't block.
        if (
            !spiritRecast &&
            !riftArmingRecast &&
            !runicShatter &&
            !adminNoCooldownRef.current &&
            (cooldownUntilRef.current[abilityId] ?? 0) > now
        ) {
            return;
        }
        if (pendingCastRef.current) return;

        if (spiritRecast || runicShatter) {
            pendingCastRef.current = abilityId;
            awaitingCastAckRef.current = true;
            awaitingCastAckSinceRef.current = performance.now();
            localCastCancelledRef.current = false;
            abilityHudRuntime.setFlashId(abilityId);
            window.clearTimeout(castFlashTimerRef.current);
            castFlashTimerRef.current = window.setTimeout(() => abilityHudRuntime.setFlashId(null), 120);
            return;
        }

        const currentId = castingAbilityRef.current;
        const current = currentId ? ABILITIES[currentId] : null;
        const busy = Boolean(castPhaseRef.current);
        if (busy) {
            // Already casting this spell — wait for recovery (hold-to-cast retries next frame)
            if (currentId === abilityId) return;
            const canCut = canInterruptOtherCast(def, current ?? undefined);
            if (!canCut && (current?.timing.blocksOtherCasts !== false || def.timing.blocksOtherCasts !== false)) {
                return;
            }
            if (canCut) {
                // Optimistic: drop local cast anim; server soft-interrupts and starts this ability
                castPhaseRef.current = "";
                castingAbilityRef.current = null;
                castAimRuntime.clear();
                predictorRef.current.clearTravel();
                predictorRef.current.clearMoveMul();
            }
        }

        pendingCastRef.current = abilityId;
        awaitingCastAckRef.current = true;
        awaitingCastAckSinceRef.current = performance.now();
        schemaCastSeenRef.current = false;
        localCastCancelledRef.current = false;
        castPhaseRef.current = "anticipation";
        castingAbilityRef.current = abilityId;
        // Crescent / combos: only telegraph the opening swing, not follow-ups.
        const comboHit =
          Boolean(ABILITIES[abilityId]?.combo) && predictorRef.current.isInComboGap()
            ? 2
            : 1;
        castAimRuntime.set(abilityId, "anticipation", comboHit);
        predictorRef.current.applyCastMove(abilityId, "anticipation");
        if (def && castBarShowsWindup(def)) {
          castBarRuntime.begin({
            abilityId,
            name: def.name,
            mode: "cast",
            durationMs: castWindupMs(def),
            interruptible: def.timing.canCancelAnticipation !== false,
          });
        } else {
          // Instant / short windup — drop any prior bar (e.g. cut into Fireball).
          castBarRuntime.clear();
        }
        abilityHudRuntime.setFlashId(abilityId);
        window.clearTimeout(castFlashTimerRef.current);
        castFlashTimerRef.current = window.setTimeout(() => abilityHudRuntime.setFlashId(null), 120);
    }, []);

    const queueCastFromSlotInput = useCallback(
        (slotInput: "mouse0" | "mouse2" | "space" | "q" | "e" | "r" | "f") => {
            const idx = slotIndexForInput(slotInput);
            if (idx < 0) return;
            queueCastAbility(loadoutRef.current[idx]);
        },
        [queueCastAbility],
    );

    /**
     * Flex slots (keys 1-3). Affordability is checked here only to avoid the
     * optimistic cast animation on a cast the server will refuse -- the server
     * re-checks and owns the spend, since Energy is its number.
     */
    const queueCastFromFlexSlot = useCallback(
        (index: number) => {
            const abilityId = flexLoadoutRef.current[index];
            if (!abilityId) return;
            const room = roomRef.current;
            const me = room?.state?.players?.get(room.sessionId) as { energy?: number } | undefined;
            if (Math.floor(me?.energy ?? 0) < flexCost(abilityId)) return;
            queueCastAbility(abilityId);
        },
        [queueCastAbility],
    );

    const clearHeldMouseCasts = useCallback(() => {
        heldCastSlotsRef.current = { mouse0: false, mouse2: false };
    }, []);

    /**
     * Pressing a different ability should preempt hold-to-chain (e.g. LMB crescent).
     * Clears other mouse holds so the new press can cast / retry when the lock frees.
     */
    const beginCastFromSlotInput = useCallback(
        (slotInput: "mouse0" | "mouse2" | "space" | "q" | "e" | "r" | "f") => {
            if (slotInput === "mouse0") {
                heldCastSlotsRef.current.mouse0 = true;
                heldCastSlotsRef.current.mouse2 = false;
            } else if (slotInput === "mouse2") {
                heldCastSlotsRef.current.mouse2 = true;
                heldCastSlotsRef.current.mouse0 = false;
            } else {
                clearHeldMouseCasts();
            }
            queueCastFromSlotInput(slotInput);
        },
        [clearHeldMouseCasts, queueCastFromSlotInput],
    );

    const queueConfirmCast = useCallback(() => {
        if (inputLockedRef.current) return;
        const abilityId = castingAbilityRef.current;
        if (!abilityId) return;
        const def = ABILITIES[abilityId];
        if (!def?.confirmOnRelease) return;
        const phase = castPhaseRef.current;
        if (phase !== "impact" && phase !== "anticipation" && phase !== "cast") return;

        portalConfirmArmedRef.current = true;
        if (phase === "impact" && portalChannelAnchorRef.current > 0 && abilityId === "portal") {
            const elapsed = performance.now() - portalChannelAnchorRef.current;
            const dist = channelChargeDistance(def, elapsed);
            predictorRef.current.beginInstantBlink(abilityId, yawRef.current, dist);
            portalChannelAnchorRef.current = 0;
            pendingConfirmRef.current = true;
            portalConfirmArmedRef.current = false;
        } else if (phase === "impact") {
            pendingConfirmRef.current = true;
            portalConfirmArmedRef.current = false;
        }
    }, []);

    const queueCancelCast = useCallback(() => {
        if (inputLockedRef.current) return;
        const abilityId = castingAbilityRef.current;
        const phase = castPhaseRef.current;
        if (!abilityId || !phase) return;
        const def = ABILITIES[abilityId];
        if (!def || !canPlayerCancelCast(def, phase)) return;
        pendingCancelRef.current = true;
        localCastCancelledRef.current = true;
        awaitingCastAckRef.current = false;
        schemaCastSeenRef.current = false;
        // Optimistic local clear; server confirms via cast_phase cancel
        castPhaseRef.current = "";
        castingAbilityRef.current = null;
        castAimRuntime.clear();
        portalChannelAnchorRef.current = 0;
        portalConfirmArmedRef.current = false;
        chargeHudRuntime.clear();
        predictorRef.current.clearMoveMul();
        const sid = sessionIdRef.current;
        if (sid) {
            if (abilityId === "iceLance") {
                cancelActiveCastHandle(sid, "iceLance");
            } else if (
                usesFrostMistFx(abilityId) ||
                usesGrooveFx(abilityId) ||
                usesHealBeamFx(abilityId) ||
                usesLifeLeechFx(abilityId)
            ) {
                cancelFollowOwnerVfx(abilityId, sid);
            } else if (abilityId === "fireball") {
                cancelActiveCastHandle(sid, "fireball");
                cancelFollowOwnerVfx("fireball", sid);
            }
        }
        window.dispatchEvent(new CustomEvent("bb-cast-anim-cancel"));
    }, []);

    /** True when a mouse press should cancel instead of starting/queuing a cast. */
    const tryMouseCancelCast = useCallback((): boolean => {
        const abilityId = castingAbilityRef.current;
        const phase = castPhaseRef.current;
        if (!abilityId || !phase) return false;
        const def = ABILITIES[abilityId];
        if (!def || !canPlayerCancelCast(def, phase)) return false;
        queueCancelCast();
        return true;
    }, [queueCancelCast]);

    const livingFighterIds = useCallback((): string[] => {
        const r = roomRef.current;
        if (!r?.state?.players) return [];
        const ids: string[] = [];
        const self = sessionIdRef.current;
        r.state.players.forEach(
            (
                p: {
                    hp?: number;
                    disconnected?: boolean;
                    role?: string;
                    roundDead?: boolean;
                },
                id: string,
            ) => {
                if (id === self) return;
                if (p.disconnected || p.role === "spectator") return;
                if (typeof p.hp === "number" && p.hp <= 0) return;
                if (p.roundDead) return;
                ids.push(id);
            },
        );
        return ids;
    }, []);

    const beginDeathSpectate = useCallback(() => {
        const ids = livingFighterIds();
        const next = ids[0] ?? null;
        deathSpectateRef.current = true;
        spectateTargetIdRef.current = next;
        setDeathSpectate(true);
        setSpectateTargetId(next);
    }, [livingFighterIds]);

    const cycleDeathSpectate = useCallback((dir: 1 | -1) => {
        if (!deathSpectateRef.current) return;
        const ids = livingFighterIds();
        if (ids.length === 0) {
            spectateTargetIdRef.current = null;
            setSpectateTargetId(null);
            return;
        }
        const cur = spectateTargetIdRef.current;
        let idx = cur ? ids.indexOf(cur) : -1;
        if (idx < 0) idx = 0;
        else idx = (idx + dir + ids.length) % ids.length;
        const next = ids[idx] ?? ids[0]!;
        spectateTargetIdRef.current = next;
        setSpectateTargetId(next);
    }, [livingFighterIds]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent, down: boolean) => {
            if (deathSpectateRef.current && down && e.code === "Tab") {
                e.preventDefault();
                cycleDeathSpectate(e.shiftKey ? -1 : 1);
                return;
            }
            if (inputLockedRef.current) return;
            if (e.repeat && down) return;

            // WASD / Esc while the emote pie is open — dismiss without casting
            // (movement / cancel-cast below still runs normally).
            if (down && emotePieOpenRef.current && (MOVE_KEY_CODES.has(e.code) || e.code === "Escape")) {
                emotePieOpenRef.current = false;
                setEmotePieOpen(false);
            }

            // Moving while a full-body emote is playing cancels it immediately.
            if (down && MOVE_KEY_CODES.has(e.code) && sessionIdRef.current && isEmoteActive(sessionIdRef.current)) {
                clearActiveEmote(sessionIdRef.current);
                roomRef.current?.send("cancel_emote");
            }

            switch (e.code) {
                case "KeyW":
                case "ArrowUp":
                    keysRef.current.up = down;
                    e.preventDefault();
                    break;
                case "KeyS":
                case "ArrowDown":
                    keysRef.current.down = down;
                    e.preventDefault();
                    break;
                case "KeyA":
                case "ArrowLeft":
                    keysRef.current.left = down;
                    e.preventDefault();
                    break;
                case "KeyD":
                case "ArrowRight":
                    keysRef.current.right = down;
                    e.preventDefault();
                    break;
                case "KeyF":
                    if (down) {
                        e.preventDefault();
                        const abilityId = castingAbilityRef.current;
                        const phase = castPhaseRef.current;
                        if (
                            abilityId === "fireball" &&
                            ABILITIES[abilityId]?.confirmOnRelease &&
                            (phase === "impact" ||
                                phase === "anticipation" ||
                                phase === "cast")
                        ) {
                            queueConfirmCast();
                        } else {
                            beginCastFromSlotInput("f");
                        }
                    }
                    break;
                case "Space":
                    if (down) {
                        e.preventDefault();
                        const near = nearInteractRef.current;
                        // Stands / dummy: Space opens UI (or claims) instead of casting.
                        if (near && near.kind !== "portal") {
                            pendingInteractRef.current = near.id;
                            if (near.kind === "npc") {
                                const npcId = npcElementIdFrom(near.id);
                                if (npcId) setTalkingNpc(npcId);
                            }
                            return;
                        }
                        beginCastFromSlotInput("space");
                    } else {
                        // Hold-to-release confirm (Portal).
                        const abilityId = castingAbilityRef.current;
                        if (abilityId && ABILITIES[abilityId]?.confirmOnRelease) {
                            e.preventDefault();
                            queueConfirmCast();
                        }
                    }
                    break;
                case "Digit1":
                case "Digit2":
                case "Digit3":
                    if (down) {
                        e.preventDefault();
                        clearHeldMouseCasts();
                        queueCastFromFlexSlot(Number(e.code.slice(5)) - 1);
                    }
                    break;
                case "KeyQ":
                    if (down) {
                        e.preventDefault();
                        beginCastFromSlotInput("q");
                    }
                    break;
                case "KeyE":
                    if (down) {
                        e.preventDefault();
                        beginCastFromSlotInput("e");
                    }
                    break;
                case "KeyR":
                    if (down) {
                        e.preventDefault();
                        beginCastFromSlotInput("r");
                    }
                    break;
                case "KeyC":
                case "Escape":
                    if (down) {
                        e.preventDefault();
                        queueCancelCast();
                    }
                    break;
                case "KeyV":
                    if (down) {
                        // Hub / queue always; arena/content for fighters (including dead taunts).
                        const phase = phaseRef.current;
                        if (!isHubWorld(phase) && phase !== "content") break;
                        if (phase === "content") {
                            const me = roomRef.current?.state?.players?.get(
                                sessionIdRef.current ?? "",
                            ) as { role?: string } | undefined;
                            if (me?.role === "spectator") break;
                        }
                        e.preventDefault();
                        emotePieOpenRef.current = true;
                        setEmotePieOpen(true);
                        // Seed the highlight from the last known cursor position
                        // immediately, in case the mouse doesn't move before release.
                        setEmoteAimAngle(emoteAimAngleRef.current);
                    } else if (emotePieOpenRef.current) {
                        e.preventDefault();
                        emotePieOpenRef.current = false;
                        setEmotePieOpen(false);
                        const idx = angleToEmoteSlotIndex(emoteAimAngleRef.current, EMOTE_PIE_SLOT_COUNT);
                        const emoteId = emoteSlotsRef.current[idx] ?? null;
                        if (emoteId) {
                            const def = getEmote(emoteId);
                            if (def && sessionIdRef.current) {
                                setActiveEmote(sessionIdRef.current, emoteId, def.durationMs);
                            }
                            roomRef.current?.send("cast_emote", { emoteId });
                        }
                    }
                    break;
            }
        };
        const down = (e: KeyboardEvent) => onKey(e, true);
        const up = (e: KeyboardEvent) => onKey(e, false);
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
        };
    }, [
        beginCastFromSlotInput,
        clearHeldMouseCasts,
        queueCastFromFlexSlot,
        queueCancelCast,
        queueConfirmCast,
        cycleDeathSpectate,
    ]);

    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            if (deathSpectateRef.current && (e.button === 0 || e.button === 2)) {
                const target = e.target as HTMLElement | null;
                if (!target?.closest?.("[data-ui-overlay]")) {
                    e.preventDefault();
                    cycleDeathSpectate(e.button === 2 ? -1 : 1);
                }
                return;
            }
            if (inputLockedRef.current) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest?.("[data-ui-overlay]")) return;
            if (e.button === 0) {
                const abilityId = castingAbilityRef.current;
                if (
                    abilityId === "fireball" &&
                    ABILITIES[abilityId]?.confirmOnRelease &&
                    (castPhaseRef.current === "impact" ||
                        castPhaseRef.current === "anticipation" ||
                        castPhaseRef.current === "cast")
                ) {
                    queueConfirmCast();
                } else {
                    beginCastFromSlotInput("mouse0");
                }
            } else if (e.button === 2) {
                e.preventDefault();
                beginCastFromSlotInput("mouse2");
            }
        };
        const onMouseUp = (e: MouseEvent) => {
            if (e.button === 0) {
                heldCastSlotsRef.current.mouse0 = false;
                // Hold-channel (Life Leech): LMB release ends the stream and starts CD.
                const abilityId = castingAbilityRef.current;
                if (abilityId && ABILITIES[abilityId]?.holdChannel) {
                    queueCancelCast();
                }
            }
            if (e.button === 2) heldCastSlotsRef.current.mouse2 = false;
        };
        const onMouseMoveForEmotePie = (e: MouseEvent) => {
            emoteAimAngleRef.current = Math.atan2(
                e.clientY - window.innerHeight / 2,
                e.clientX - window.innerWidth / 2,
            );
            if (emotePieOpenRef.current) setEmoteAimAngle(emoteAimAngleRef.current);
        };
        const clearHeld = () => {
            heldCastSlotsRef.current.mouse0 = false;
            heldCastSlotsRef.current.mouse2 = false;
        };
        const onContextMenu = (e: MouseEvent) => {
            if (inputLockedRef.current) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest?.("[data-ui-overlay]")) return;
            e.preventDefault();
        };

        /**
         * Side buttons: cancel cast + block browser back/forward.
         * Must handle cancel here — capture stopPropagation never reaches window listeners.
         */
        const onSideButtonCapture = (e: MouseEvent) => {
            if (e.button !== 3 && e.button !== 4) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.type !== "mousedown") return;
            if (inputLockedRef.current) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest?.("[data-ui-overlay]")) return;
            tryMouseCancelCast();
        };
        const capture = { capture: true } as const;
        const lockHistory = () => {
            try {
                history.pushState({ bbPlay: 1 }, "", location.href);
            } catch {
                /* ignore */
            }
        };
        const onPopState = () => lockHistory();

        lockHistory();
        window.addEventListener("popstate", onPopState);
        document.addEventListener("mousedown", onSideButtonCapture, capture);
        document.addEventListener("mouseup", onSideButtonCapture, capture);
        document.addEventListener("auxclick", onSideButtonCapture, capture);

        window.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mouseup", onMouseUp);
        window.addEventListener("mousemove", onMouseMoveForEmotePie);
        window.addEventListener("blur", clearHeld);
        window.addEventListener("contextmenu", onContextMenu);
        return () => {
            window.removeEventListener("popstate", onPopState);
            document.removeEventListener("mousedown", onSideButtonCapture, capture);
            document.removeEventListener("mouseup", onSideButtonCapture, capture);
            document.removeEventListener("auxclick", onSideButtonCapture, capture);
            window.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mouseup", onMouseUp);
            window.removeEventListener("mousemove", onMouseMoveForEmotePie);
            window.removeEventListener("blur", clearHeld);
            window.removeEventListener("contextmenu", onContextMenu);
        };
    }, [beginCastFromSlotInput, queueCancelCast, queueConfirmCast, tryMouseCancelCast, cycleDeathSpectate]);

    useEffect(() => {
        if (options.enabled === false) return;

        let cancelled = false;
        const client = new Client(options.endpoint);
        clientRef.current = client;
        predictorRef.current = new LocalPredictor();
        setStatus("connecting");
        setPhase("hub");
        phaseRef.current = "hub";
        setQueueModes([]);
        setContentMode(null);
        contentModeRef.current = null;
        npcsRef.current = [];
        setMatchPause(null);

        (async () => {
            try {
                const savedContent = loadContentRejoin();
                if (savedContent?.token) {
                    try {
                        const rejoined = await withTimeout(
                            client.reconnect(savedContent.token),
                            ROOM_CONNECT_TIMEOUT_MS,
                            "content reconnect",
                        );
                        if (cancelled) {
                            rejoined.leave(true);
                            return;
                        }
                        wireRoom(rejoined, "content", savedContent.mode);
                        showToast("Rejoined match");
                        return;
                    } catch {
                        clearContentRejoin();
                    }
                }

                const requestedHub = options.hubOwnerId ?? options.userId;
                const savedHub = loadHubRejoin();
                // Refresh often resets React hub state to "home"; prefer last host seat.
                const hubOwnerId =
                    (options.hubOwnerId && options.hubOwnerId !== options.userId
                        ? options.hubOwnerId
                        : null) ??
                    (savedHub?.hubOwnerId && savedHub.hubOwnerId !== options.userId
                        ? savedHub.hubOwnerId
                        : null) ??
                    loadPreferredHub(options.userId) ??
                    requestedHub;

                if (savedHub?.token && savedHub.hubOwnerId === hubOwnerId) {
                    try {
                        const rejoined = await withTimeout(
                            client.reconnect(savedHub.token),
                            ROOM_CONNECT_TIMEOUT_MS,
                            "hub reconnect",
                        );
                        if (cancelled) {
                            rejoined.leave(true);
                            return;
                        }
                        wireRoom(rejoined, "hub", null);
                        showToast("Rejoined hub");
                        return;
                    } catch {
                        clearHubRejoin();
                    }
                }

                try {
                    const joined = await withTimeout(
                        client.joinOrCreate(ROOM.BASE_CITY, {
                            userId: options.userId,
                            displayName: options.displayName,
                            color: options.color,
                            accessToken: options.accessToken ?? undefined,
                            hubOwnerId,
                        }),
                        ROOM_CONNECT_TIMEOUT_MS,
                        "hub join",
                    );
                    if (cancelled) {
                        joined.leave(true);
                        return;
                    }
                    wireRoom(joined, "hub", null);
                } catch (joinErr) {
                    // Host hub may be gone; fall back home rather than hard-fail.
                    if (hubOwnerId !== options.userId) {
                        console.warn("[hub] preferred hub join failed, returning home", joinErr);
                        clearHubRejoin();
                        clearPreferredHub();
                        const hadVisitState =
                            Boolean(options.hubOwnerId) && options.hubOwnerId !== options.userId;
                        if (hadVisitState) {
                            // Clear visit state so the connect effect remounts into home hub.
                            optionsRef.current.onActiveHubOwnerId?.(null);
                            return;
                        }
                        const home = await withTimeout(
                            client.joinOrCreate(ROOM.BASE_CITY, {
                                userId: options.userId,
                                displayName: options.displayName,
                                color: options.color,
                                accessToken: options.accessToken ?? undefined,
                                hubOwnerId: options.userId,
                            }),
                            ROOM_CONNECT_TIMEOUT_MS,
                            "home hub join",
                        );
                        if (cancelled) {
                            home.leave(true);
                            return;
                        }
                        wireRoom(home, "hub", null);
                        showToast("Host hub unavailable — returned home");
                        return;
                    }
                    throw joinErr;
                }
            } catch (err) {
                console.error(err);
                if (!cancelled) setStatus("error");
            }
        })();

        const hubOwnerAtStart = options.hubOwnerId ?? options.userId;
        return () => {
            cancelled = true;
            transferringRef.current = false;
            clearCrescentSpawnState();
            const room = roomRef.current;
            roomRef.current = null;
            clientRef.current = null;
            const opts = optionsRef.current;
            const stillSameHub = (opts.hubOwnerId ?? opts.userId) === hubOwnerAtStart;
            const enabled = opts.enabled !== false;
            // Reload / same-hub remount: soft-leave so allowReconnection can restore the seat.
            // Hub switch or disable: consented leave strips the seat immediately.
            const consented = !(stillSameHub && enabled);
            if (consented) clearHubRejoin();
            room?.leave(consented);
        };
    }, [
        options.endpoint,
        options.userId,
        options.displayName,
        options.color,
        options.accessToken,
        options.hubOwnerId,
        options.enabled,
        wireRoom,
        showToast,
    ]);

    const clearLocalCombatCastStateRef = useRef(clearLocalCombatCastState);
    clearLocalCombatCastStateRef.current = clearLocalCombatCastState;

    useEffect(() => {
        let raf = 0;
        let last = performance.now();

        const onInteractRequest = (e: Event) => {
            const detail = (e as CustomEvent<string>).detail;
            if (detail) pendingInteractRef.current = detail;
        };
        const onDeathAnim = (e: Event) => {
            const durationSec = (e as CustomEvent<{ durationSec?: number }>).detail?.durationSec;
            if (typeof durationSec === "number" && durationSec > 0) {
                setDeathAnimMs(Math.round(durationSec * 1000));
            }
        };
        window.addEventListener("bb-send-interact", onInteractRequest as EventListener);
        window.addEventListener("bb-death-anim", onDeathAnim as EventListener);

        const loop = (now: number) => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            const r = roomRef.current;
            const predictor = predictorRef.current;

            if (r) {
                const serverMe = r.state?.players?.get(r.sessionId) as
                    | {
                          x: number;
                          z: number;
                          yaw: number;
                          lastInputSeq: number;
                          hp?: number;
                          roundDead?: boolean;
                          role?: string;
                          castPhase?: string;
                          castAbilityId?: string;
                          statuses?: {
                              forEach: (cb: (row: { statusId?: string; stacks?: number }) => void) => void;
                          };
                      }
                    | undefined;

                const playersMap = r.state?.players as
                    | Map<
                          string,
                          { x: number; z: number; disconnected?: boolean; hp?: number; id?: string }
                      >
                    | undefined;
                const targetsMap = r.state?.targets as
                    | Map<string, { x: number; z: number; hp?: number }>
                    | undefined;
                const volcanoesMap = r.state?.volcanoes as
                    | Map<string, { x: number; z: number; radius?: number; phase?: string }>
                    | undefined;
                const riftPortalsMap = r.state?.riftPortals as
                    | Map<
                          string,
                          { x: number; z: number; yaw?: number; radius?: number; phase?: string }
                      >
                    | undefined;
                if (playersMap) {
                    const localUserId = playersMap.get(r.sessionId)?.id ?? null;
                    const dynamics = [
                        ...unitCollidersExcept(
                            playersMap.entries(),
                            targetsMap?.entries() ?? null,
                            r.sessionId,
                            localUserId,
                        ),
                        ...(volcanoesMap ? volcanoColliders(volcanoesMap.entries()) : []),
                    ];
                    const baseStatics = staticsForPhase(phaseRef.current, contentModeRef.current);
                    const pred = predictorRef.current.state;
                    const riftBoxes = riftPortalsMap
                        ? riftPortalColliders(riftPortalsMap.entries(), {
                              x: pred.x,
                              z: pred.z,
                          })
                        : [];
                    const statics =
                        riftBoxes.length > 0 ? [...baseStatics, ...riftBoxes] : baseStatics;
                    predictor.setWorldColliders(statics, dynamics);
                    setWorldStaticColliders(statics);
                }

                if (serverMe) {
                    const statusEntries: { def: NonNullable<ReturnType<typeof getStatus>>; stacks: number }[] = [];
                    serverMe.statuses?.forEach((row) => {
                        const def = row.statusId ? getStatus(row.statusId) : undefined;
                        if (def) statusEntries.push({ def, stacks: row.stacks ?? 1 });
                    });
                    predictor.setStatusMoveMul(combineStatusMoveMul(statusEntries));
                } else {
                    predictor.setStatusMoveMul(1);
                }

                // Target leash for prediction; caster free vs players, leashed vs props.
                {
                    let tether: { anchorX: number; anchorZ: number; maxDistance: number } | null =
                        null;
                    let pullLocal = false;
                    const chains = (r.state as { astralChains?: Map<string, {
                        casterId?: string;
                        targetId?: string;
                        maxDistance?: number;
                    }> } | undefined)?.astralChains;
                    const sid = r.sessionId;
                    chains?.forEach((chain) => {
                        if (tether) return;
                        if (chain.targetId === sid) {
                            const other = playersMap?.get(chain.casterId ?? "");
                            if (other && typeof other.x === "number") {
                                tether = {
                                    anchorX: other.x,
                                    anchorZ: other.z,
                                    maxDistance: chain.maxDistance ?? 1.5,
                                };
                                pullLocal = true;
                            }
                            return;
                        }
                        if (chain.casterId !== sid) return;
                        const prop = targetsMap?.get(chain.targetId ?? "") as
                            | { x?: number; z?: number; kind?: string }
                            | undefined;
                        if (
                            prop &&
                            typeof prop.x === "number" &&
                            prop.kind === "prop"
                        ) {
                            tether = {
                                anchorX: prop.x,
                                anchorZ: prop.z,
                                maxDistance: chain.maxDistance ?? 1.5,
                            };
                        }
                    });
                    predictor.setAstralTether(tether);
                    if (tether && pullLocal) {
                        predictor.applyAstralTetherPull(ASTRAL_CHAIN_CAST.casterPullStrength);
                    }
                }

                if (serverMe && !predictor.isSeeded) {
                    predictor.seed(serverMe.x, serverMe.z, serverMe.yaw);
                    predictedRef.current = { ...predictor.state };
                    lastAckRef.current = serverMe.lastInputSeq;
                }

                // Soft-respawn / teleport: hard snap when server moved far from prediction.
                // Revenge blink is instant — snap even on short hops while phased.
                if (serverMe && predictor.isSeeded) {
                    const jump = Math.hypot(
                        serverMe.x - predictor.state.x,
                        serverMe.z - predictor.state.z,
                    );
                    const revengePhased = hasStatusId(serverMe.statuses, "revengePhased");
                    if (jump > 6 || (revengePhased && jump > 0.25)) {
                        // Latch vanish before the predicted pose jumps so we never
                        // paint the mesh at the landing spot for a frame.
                        if (revengePhased && sessionIdRef.current) {
                            beginRevengeVanish(sessionIdRef.current);
                        }
                        predictor.seed(serverMe.x, serverMe.z, serverMe.yaw);
                        predictedRef.current = { ...predictor.state };
                        lastAckRef.current = serverMe.lastInputSeq;
                    }
                }

                if (serverMe) {
                    if (localCastCancelledRef.current) {
                        // Stale schema still shows the cast we cancelled — keep full move speed
                        // and don't resurrect castPhaseRef until the server clears.
                        if (!serverMe.castPhase) {
                            localCastCancelledRef.current = false;
                            if (!predictor.isInComboGap()) predictor.clearMoveMul();
                        }
                    } else if (serverMe.castPhase) {
                        // After cancel / combat_fx idle, schema can lag with a stale castPhase.
                        // clear() suppresses the bus — don't let schema resurrect the ghost.
                        if (
                            !castAimRuntime.isSchemaFallbackAllowed() &&
                            !awaitingCastAckRef.current &&
                            !pendingCastRef.current
                        ) {
                            /* wait for schema to clear */
                        } else {
                            schemaCastSeenRef.current = true;
                            castPhaseRef.current = serverMe.castPhase;
                            castingAbilityRef.current = serverMe.castAbilityId || null;
                            castAimRuntime.set(
                                castingAbilityRef.current,
                                castPhaseRef.current,
                                serverMe.castComboHit || 1,
                            );
                            awaitingCastAckRef.current = false;
                            awaitingCastAckSinceRef.current = 0;
                            if (serverMe.castAbilityId) {
                                predictor.applyCastMove(serverMe.castAbilityId, serverMe.castPhase);
                            }
                        }
                    } else if (awaitingCastAckRef.current) {
                        // Server rejected or never acked — don't stay busy forever.
                        const waited = performance.now() - awaitingCastAckSinceRef.current;
                        if (waited > 400) {
                            awaitingCastAckRef.current = false;
                            awaitingCastAckSinceRef.current = 0;
                            pendingCastRef.current = undefined;
                            castPhaseRef.current = "";
                            castingAbilityRef.current = null;
                            schemaCastSeenRef.current = false;
                            castAimRuntime.clear();
                            if (!predictor.isInComboGap()) predictor.clearMoveMul();
                        }
                    } else if (!pendingCastRef.current && !awaitingCastAckRef.current) {
                        // combat_fx often lands before schema gains castPhase. Keep local
                        // phase + aim ghost until schema has observed this cast (or fx ends it).
                        if (castPhaseRef.current && !schemaCastSeenRef.current) {
                            /* schema lag at cast start — do not clear */
                        } else {
                            const hadCast =
                                castPhaseRef.current !== "" || castingAbilityRef.current != null;
                            castPhaseRef.current = "";
                            castingAbilityRef.current = null;
                            schemaCastSeenRef.current = false;
                            if (hadCast) castAimRuntime.clear();
                            // combat_fx often clears moveMul before schema drops castPhase; the
                            // branch above can re-apply cast slow, then leave it stuck when schema
                            // finally clears. Restore full speed unless a combo gap owns the mul.
                            if (hadCast && !predictor.isInComboGap()) {
                                predictor.clearMoveMul();
                            }
                        }
                    }
                }

                if (serverMe && predictor.isSeeded && serverMe.lastInputSeq !== lastAckRef.current) {
                    lastAckRef.current = serverMe.lastInputSeq;
                    predictor.reconcile(
                        serverMe.x,
                        serverMe.z,
                        serverMe.yaw,
                        serverMe.lastInputSeq,
                    );
                    predictedRef.current = { ...predictor.state };
                }

                const st = r.state as { matchPhase?: string; paused?: boolean } | undefined;
                const gateOpts = {
                    hp: serverMe?.hp,
                    roundDead: serverMe?.roundDead,
                    role: serverMe?.role,
                    matchPhase: st?.matchPhase,
                };
                const simPaused = Boolean(st?.paused) || pvePausedRef.current;
                const canMove = clientCanMove(gateOpts) && !simPaused;
                const revengePhased = hasStatusId(serverMe?.statuses, "revengePhased");
                const canCombat =
                    clientCanCombat(gateOpts) && !simPaused && !revengePhased;
                const spectator = serverMe?.role === "spectator";
                // Casts are gated by canCombat below — don't lock WASD / emote pie just because casts are off.
                inputLockedRef.current = uiInputLockedRef.current;
                if (!canMove) {
                    keysRef.current = { up: false, down: false, left: false, right: false };
                    heldCastSlotsRef.current = { mouse0: false, mouse2: false };
                    pendingCastRef.current = undefined;
                    pendingCancelRef.current = false;
                    // Freeze to server pose — predicting into walls while server ignores input flickers.
                    if (serverMe && predictor.isSeeded) {
                        predictor.seed(serverMe.x, serverMe.z, serverMe.yaw);
                        predictedRef.current = { ...predictor.state };
                        lastAckRef.current = serverMe.lastInputSeq;
                    }
                } else if (!canCombat && !revengePhased) {
                    // Move-only (spectator, round_end celebrate, or fighter between rounds): clear cast intent.
                    // Revenge vanish: keep held / pending clicks so they fire the instant you reappear.
                    heldCastSlotsRef.current = { mouse0: false, mouse2: false };
                    pendingCastRef.current = undefined;
                    pendingCancelRef.current = false;
                    pendingConfirmRef.current = false;
                }

                // Hub interact pads: Space prompt for stands/dummy; portals auto-open on enter.
                // Matchmaking queue still counts as hub world so shop / stands stay usable.
                if (isHubWorld(phaseRef.current) && predictor.isSeeded) {
                    const px = predictedRef.current.x;
                    const pz = predictedRef.current.z;
                    let best: NearInteract = null;
                    let bestDist = Infinity;
                    for (const s of HUB_STANDS) {
                        if (!pointInInteractZone(px, pz, s)) continue;
                        const d = interactZoneDist(px, pz, s);
                        if (d < bestDist) {
                            bestDist = d;
                            best = { id: s.id, label: s.label, kind: "stand" };
                        }
                    }
                    for (const dmy of HUB_PRACTICE_DUMMIES) {
                        if (!pointInInteractZone(px, pz, dmy)) continue;
                        const d = interactZoneDist(px, pz, dmy);
                        if (d < bestDist) {
                            bestDist = d;
                            best = { id: dmy.id, label: "Practice dummy", kind: "dummy" };
                        }
                    }
                    for (const npc of HUB_NPCS) {
                        const d = Math.hypot(px - npc.x, pz - npc.z);
                        if (d > NPC_INTERACT_RADIUS || d >= bestDist) continue;
                        bestDist = d;
                        best = { id: npcInteractId(npc.id), label: npc.name, kind: "npc" };
                    }
                    let portalNear: NearInteract = null;
                    let portalDist = Infinity;
                    for (const p of HUB_PORTALS) {
                        if (!pointInInteractZone(px, pz, p)) continue;
                        const d = interactZoneDist(px, pz, p);
                        if (d < portalDist) {
                            portalDist = d;
                            portalNear = { id: p.id, label: p.label, kind: "portal" };
                        }
                    }
                    // Don't auto-open portals while already searching for a match.
                    if (portalNear && phaseRef.current === "hub") {
                        if (
                            lastPortalAutoIdRef.current !== portalNear.id &&
                            activeUiRef.current == null &&
                            !uiInputLockedRef.current
                        ) {
                            lastPortalAutoIdRef.current = portalNear.id;
                            pendingInteractRef.current = portalNear.id;
                        }
                    } else {
                        lastPortalAutoIdRef.current = null;
                    }
                    // Prompt only for press-to-interact pads (not portals).
                    const prompt =
                        best && activeUiRef.current == null && !uiInputLockedRef.current ? best : null;
                    nearInteractRef.current = best;
                    setInteractPrompt(prompt ? { label: prompt.label } : null);
                    setNearInteract((prev) => {
                        if (prev?.id === prompt?.id && prev?.kind === prompt?.kind) return prev;
                        return prompt;
                    });
                } else if (predictor.isSeeded && npcsRef.current.length > 0) {
                    // Authored maps: villagers, shopkeepers and quest givers read
                    // from the same document the server validates against. Plain
                    // radius rather than an oriented pad -- an NPC is a person you
                    // walk up to, not a floor plate you stand on.
                    const px = predictedRef.current.x;
                    const pz = predictedRef.current.z;
                    let best: NearInteract = null;
                    let bestDist = NPC_INTERACT_RADIUS;
                    for (const npc of npcsRef.current) {
                        const d = Math.hypot(px - npc.x, pz - npc.z);
                        if (d > bestDist) continue;
                        bestDist = d;
                        best = { id: npcInteractId(npc.id), label: npc.name, kind: "npc" };
                    }
                    const prompt =
                        best && activeUiRef.current == null && !uiInputLockedRef.current ? best : null;
                    nearInteractRef.current = best;
                    setInteractPrompt(prompt ? { label: prompt.label } : null);
                    setNearInteract((prev) => {
                        if (prev?.id === prompt?.id && prev?.kind === prompt?.kind) return prev;
                        return prompt;
                    });
                } else if (nearInteractRef.current != null) {
                    nearInteractRef.current = null;
                    lastPortalAutoIdRef.current = null;
                    clearInteractPrompt();
                    setNearInteract(null);
                }

                const keys = keysRef.current;
                let moveX = 0;
                let moveZ = 0;
                if (canMove) {
                    if (keys.right) moveX += 1;
                    if (keys.left) moveX -= 1;
                    if (keys.down) moveZ += 1;
                    if (keys.up) moveZ -= 1;
                }
                if (canCombat) {
                    // Hold-to-cast: only the active mouse hold re-fires (other was cleared on new press)
                    if (heldCastSlotsRef.current.mouse2) queueCastFromSlotInput("mouse2");
                    else if (heldCastSlotsRef.current.mouse0) queueCastFromSlotInput("mouse0");
                }

                if (predictor.isSeeded) {
                    seqRef.current += 1;
                    const castId = canCombat ? pendingCastRef.current : undefined;
                    // Consume pending only when sent, or when combat is blocked for a
                    // reason other than revenge vanish (keep click through reappear).
                    if (canCombat || !revengePhased) {
                        pendingCastRef.current = undefined;
                    }
                    const cancelCast = canCombat ? pendingCancelRef.current : false;
                    if (canCombat || !revengePhased) {
                        pendingCancelRef.current = false;
                    }
                    const confirmCast = canCombat ? pendingConfirmRef.current : false;
                    if (canCombat || !revengePhased) {
                        pendingConfirmRef.current = false;
                    }

                    const input: PlayerInput = {
                        seq: seqRef.current,
                        dt,
                        moveX,
                        moveZ,
                        yaw: yawRef.current,
                        castId,
                        cancelCast: cancelCast || undefined,
                        confirmCast: confirmCast || undefined,
                        interactId: canCombat ? pendingInteractRef.current : undefined,
                    };
                    // Hand Shield: slow-turn the sent/predicted yaw (cursor still free).
                    {
                        const meShield = r.state?.players?.get(r.sessionId) as
                            | {
                                  statuses?: {
                                      forEach: (cb: (row: { statusId?: string }) => void) => void;
                                  };
                              }
                            | undefined;
                        if (hasStatusId(meShield?.statuses, "handShielding")) {
                            input.yaw = stepYawToward(
                                predictedRef.current.yaw,
                                yawRef.current,
                                HAND_SHIELD_CAST.yawTurnRate,
                                dt,
                            );
                        }
                    }
                    // Always send cursor ground aim so placed spells (shrooms/volcano)
                    // can track the pointer during windup, not only on the cast frame.
                    const aim = getGroundAim();
                    if (aim) {
                        input.aimX = aim.x;
                        input.aimZ = aim.z;
                    }
                    pendingInteractRef.current = undefined;

                    if (canMove) {
                        const predicted = predictor.predict(input);
                        predictedRef.current = predicted;
                    }
                    r.send("input", { input });
                }

                if (now - lastHudUpdate.current > 100) {
                    lastHudUpdate.current = now;
                    setLocalPlayer({ x: predictedRef.current.x, z: predictedRef.current.z });
                    const me = r.state?.players?.get(r.sessionId) as
                        | {
                              copper?: number;
                              silver?: number;
                              gold?: number;
                              essence?: number;
                              loadout?: string;
                              talents?: string;
                              hp?: number;
                              maxHp?: number;
                              energy?: number;
                              castPhase?: string;
                              team?: string;
                              rematchReady?: boolean;
                              statuses?: {
                                  forEach: (cb: (row: { statusId?: string; stacks?: number }) => void) => void;
                              };
                          }
                        | undefined;
                    if (me && typeof me.copper === "number") {
                        const nextLoadout = me.loadout
                            ? me.loadout.split(",").filter(Boolean)
                            : null;
                        const nextTalents = me.talents
                            ? me.talents.split(",").filter(Boolean)
                            : null;
                        setEconomy((prev) => {
                            const loadoutUnchanged =
                                !nextLoadout ||
                                nextLoadout.join(",") === prev.loadout.join(",");
                            const talentsUnchanged =
                                !nextTalents ||
                                nextTalents.join(",") === prev.talents.join(",");
                            return {
                                ...prev,
                                copper: me.copper ?? prev.copper,
                                silver: me.silver ?? prev.silver,
                                gold: me.gold ?? prev.gold,
                                essence: me.essence ?? prev.essence,
                                rubies:
                                    typeof (me as { rubies?: number }).rubies === "number"
                                        ? (me as { rubies: number }).rubies
                                        : prev.rubies,
                                loadout: loadoutUnchanged ? prev.loadout : nextLoadout!,
                                talents: talentsUnchanged ? prev.talents : nextTalents!,
                            };
                        });
                    }
                    if (me && typeof me.hp === "number") {
                        const shieldRows: { statusId?: string; stacks?: number }[] = [];
                        me.statuses?.forEach((row) => {
                            shieldRows.push({ statusId: row.statusId, stacks: row.stacks });
                        });
                        const shield = totalShieldAbsorb(shieldRows);
                        const maxHp = me.maxHp ?? PLAYER_BASE_MAX_HP;
                        setLocalHp({
                            hp: me.hp,
                            maxHp,
                            shield,
                            energy: me.energy ?? 0,
                        });
                        const casting = Boolean(me.castPhase);
                        const damaged = me.hp < maxHp - 0.05;
                        const now = performance.now();
                        if (prevLocalHpRef.current != null && me.hp < prevLocalHpRef.current - 0.05) {
                            combatHudLingerUntilRef.current = now + COMBAT_ENGAGE_LINGER_MS;
                        }
                        prevLocalHpRef.current = me.hp;
                        if (damaged || shield > 0 || casting || me.hp <= 0) {
                            combatHudLingerUntilRef.current = now + COMBAT_ENGAGE_LINGER_MS;
                        }
                        const showHud =
                            damaged || shield > 0 || casting || me.hp <= 0 || now < combatHudLingerUntilRef.current;
                        setCombatHudVisible((prev) => (prev === showHud ? prev : showHud));
                        if (me.hp <= 0) {
                            setDiedAt((prev) => prev ?? Date.now());
                        } else if (diedAtRef.current != null) {
                            // Round restore / soft-respawn: server CDs were wiped; unlock client.
                            clearLocalCombatCastStateRef.current();
                            setDiedAt(null);
                            setDeathAnimMs(3000);
                        }
                    }

                    const st = r.state as
                        | {
                              matchPhase?: string;
                              matchRound?: number;
                              scoreA?: number;
                              scoreB?: number;
                              scoreC?: number;
                              phaseEndsAt?: number;
                              matchMode?: string;
                          }
                        | undefined;
                    if (st?.matchPhase) {
                        setArenaHud({
                            matchPhase: st.matchPhase,
                            matchRound: st.matchRound ?? 0,
                            scoreA: st.scoreA ?? 0,
                            scoreB: st.scoreB ?? 0,
                            scoreC:
                                st.matchMode === "arena_1v1v1"
                                    ? (st.scoreC ?? 0)
                                    : undefined,
                            phaseEndsAt: st.phaseEndsAt ?? 0,
                            matchMode: st.matchMode ?? "",
                            localTeam: me?.team ?? "",
                            rematchReady: Boolean(me?.rematchReady),
                        });
                        if (st.matchPhase === "countdown" || st.matchPhase === "fighting") {
                            setMatchRecap(null);
                        }
                    } else if (phaseRef.current !== "content") {
                        setArenaHud(null);
                    }
                }
            }

            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("bb-send-interact", onInteractRequest as EventListener);
            window.removeEventListener("bb-death-anim", onDeathAnim as EventListener);
        };
    }, []);

    const sendInteract = useCallback((interactId: string) => {
        window.dispatchEvent(new CustomEvent("bb-send-interact", { detail: interactId }));
    }, []);

    const setYaw = useCallback((yaw: number) => {
        yawRef.current = yaw;
    }, []);

    const confirmPortal = useCallback(
        (portal: "pvp" | "pve", params: { modes?: string[]; content?: string; modifiers?: string[] }) => {
            roomRef.current?.send("portal_confirm", { portal, params });
            setActiveUi(null);
        },
        [],
    );

    const cancelQueue = useCallback(() => {
        roomRef.current?.send("queue_cancel");
    }, []);

    const returnToHub = useCallback(() => {
        setWaveHud(null);
        setPvePausedLocal(false);
        setWaveRunRecap(null);
        roomRef.current?.send("return_hub");
    }, []);

    const setPvePaused = useCallback((paused: boolean) => {
        setPvePausedLocal(paused);
        roomRef.current?.send("pve_pause", { paused: Boolean(paused) });
    }, []);

    const voteRematch = useCallback(() => {
        setWaveRunRecap((prev) => (prev ? { ...prev, retryReady: true } : prev));
        roomRef.current?.send("rematch_vote");
    }, []);

    const requestRespawn = useCallback(() => {
        if (diedAtRef.current == null) return;
        roomRef.current?.send("respawn");
    }, []);

    const kickFromHub = useCallback((sessionId: string) => {
        roomRef.current?.send("hub_kick", { sessionId });
    }, []);

    const grantHubResources = useCallback(
        (
            sessionId: string,
            amounts: { essence: number; copper: number; silver: number; gold: number },
        ) => {
            roomRef.current?.send("hub_grant_resources", {
                targetSessionId: sessionId,
                ...amounts,
            });
        },
        [],
    );

    const beginHubIntroPose = useCallback(() => {
        const house = HUB_STANDS.find((s) => s.kind === "customization");
        const portal = HUB_PORTALS.find((p) => p.kind === "pvp");
        if (house) {
            const lookX = portal?.x ?? house.x;
            const lookZ = portal?.z ?? house.z;
            // Face portal, then turn ~25° left so the House reads in frame.
            const yaw =
                Math.atan2(lookX - house.x, lookZ - house.z) + (-25 * Math.PI) / 180;
            predictorRef.current.seed(house.x, house.z, yaw);
            predictedRef.current = { x: house.x, z: house.z, yaw };
            yawRef.current = yaw;
        }
        roomRef.current?.send("hub_intro_begin");
    }, []);

    const completeHubIntro = useCallback(() => {
        roomRef.current?.send("hub_intro_complete");
        setIntroCompleted(true);
    }, []);

    const replayHubIntro = useCallback(() => {
        roomRef.current?.send("hub_replay_intro");
    }, []);

    const softResetCharacter = useCallback(() => {
        roomRef.current?.send("hub_soft_reset_character");
    }, []);

    const refreshHubQuests = useCallback(() => {
        roomRef.current?.send("hub_quests");
    }, []);

    const openHubChest = useCallback((chestId: string) => {
        setPendingChestOpenId(chestId);
        // Start reveal immediately with known rarity; fill loot when server answers.
        setHubChests((prev) => {
            const chest = prev.find((c) => c.id === chestId);
            setChestReveal({
                quality: chest?.quality ?? "green",
                essence: 0,
                copper: 0,
                lines: [],
                awaitingLoot: true,
            });
            return prev.filter((c) => c.id !== chestId);
        });
        roomRef.current?.send("hub_open_chest", { chestId });
        // Safety: if server never answers, unlock after a while.
        window.setTimeout(() => {
            setPendingChestOpenId((cur) => {
                if (cur !== chestId) return cur;
                setChestReveal((r) => (r?.awaitingLoot ? null : r));
                return null;
            });
        }, 12_000);
    }, []);

    const spawnHubChest = useCallback((quality: "green" | "blue" | "purple" | "legendary") => {
        roomRef.current?.send("hub_spawn_chest", { quality });
    }, []);

    const setAdminNoCooldownEnabled = useCallback((enabled: boolean) => {
        roomRef.current?.send("hub_admin_no_cooldown", { enabled });
    }, []);

    /** Admin: open any registered map alone, no mode attached. */
    const adminTpToMap = useCallback((mapId: string) => {
        roomRef.current?.send("hub_admin_tp_map", { mapId });
    }, []);

    const clearChestReveal = useCallback(() => {
        setChestReveal(null);
        setPendingChestOpenId(null);
    }, []);

    const acknowledgeQuestAlerts = useCallback(() => {
        setUnseenQuestCompletions(0);
    }, []);

    const notifyFriendCodeRedeemed = useCallback(() => {
        roomRef.current?.send("hub_friend_code_redeemed");
    }, []);

    const kickFromParty = useCallback((sessionId: string) => {
        roomRef.current?.send("party_kick", { sessionId });
    }, []);

    const inviteToParty = useCallback((sessionId: string) => {
        roomRef.current?.send("party_invite", { sessionId });
    }, []);

    const inviteFriendToParty = useCallback((userId: string) => {
        roomRef.current?.send("party_invite_friend", { userId });
    }, []);

    const setPartySeat = useCallback((sessionId: string, seat: PvpSeat) => {
        roomRef.current?.send("party_set_seat", { sessionId, seat });
    }, []);

    const lockParty = useCallback((matchKind: "ranked" | "unranked" | "coop_pve" = "ranked") => {
        roomRef.current?.send("party_lock", { matchKind });
    }, []);

    const refreshRanked = useCallback(() => {
        roomRef.current?.send("hub_ranked_request");
        roomRef.current?.send("hub_ranked_leaderboard");
    }, []);

    const cancelParty = useCallback(() => {
        roomRef.current?.send("party_cancel");
        setActiveUi(null);
    }, []);

    const leaveParty = useCallback(() => {
        roomRef.current?.send("party_leave");
        setActiveUi(null);
    }, []);

    const respondPartyInvite = useCallback((accept: boolean) => {
        const invite = partyInvite;
        if (!invite) return;
        roomRef.current?.send("party_respond", { accept, partyId: invite.partyId });
        setPartyInvite(null);
        if (accept) setActiveUi("party_lobby");
    }, [partyInvite]);

    useEffect(() => {
        (window as unknown as { __bbSetYaw?: (y: number) => void }).__bbSetYaw = setYaw;
        return () => {
            delete (window as unknown as { __bbSetYaw?: (y: number) => void }).__bbSetYaw;
        };
    }, [setYaw]);

    return {
        status,
        toast,
        activeUi,
        setActiveUi,
        npcDialogue,
        closeNpcDialogue,
        room,
        localPlayer,
        sendInteract,
        predictedRef,
        setYaw,
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
        spectateTargetId,
        beginDeathSpectate,
        hubRoster,
        isHubAdmin,
        adminNoCooldown,
        setAdminNoCooldownEnabled,
        introCompleted,
        introReplayToken,
        kickFromHub,
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
        kickFromParty,
        arenaHud,
        waveHud,
        pvePaused,
        setPvePaused,
        waveRunRecap,
        matchRecap,
        voteRematch,
        rankedState,
        rankedLeaderboard,
        refreshRanked,
        party,
        partyInvite,
        nearInteract,
        inviteToParty,
        inviteFriendToParty,
        setPartySeat,
        lockParty,
        cancelParty,
        leaveParty,
        respondPartyInvite,
        emotePieOpen,
        emoteAimAngle,
    };
}
