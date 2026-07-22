import { useCallback, useEffect, useRef, useState } from "react";
import { Client, Room } from "colyseus.js";
import { ABILITIES, ROOM, baseCityStaticColliders, normalizeLoadout, playerCollidersExcept, slotIndexForInput, type PlayerInput } from "@battlebeasts/shared";
import { clearContentRejoin, loadContentRejoin, saveContentRejoin } from "./contentRejoin";
import { LocalPredictor } from "./LocalPredictor";
import type { FxBurst } from "./CombatVfx";

const FX_COLORS: Record<"aoe" | "melee" | "dash" | "hit", string> = {
    aoe: "#c084fc",
    melee: "#fb923c",
    dash: "#a3e635",
    hit: "#f87171",
};

export type ActiveUi =
    | "customization"
    | "build"
    | "talent"
    | "shop"
    | "portal_pvp"
    | "portal_pve"
    | null;

export type SessionPhase = "hub" | "queued" | "content";

export type MatchPauseInfo = {
    reason: "pvp_reconnect" | "pve_reconnect" | "resume_grace";
    until: number;
    playerName?: string;
} | null;

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
    const [room, setRoom] = useState<Room | null>(null);
    const [phase, setPhase] = useState<SessionPhase>("hub");
    const [queueModes, setQueueModes] = useState<string[]>([]);
    const [contentMode, setContentMode] = useState<string | null>(null);
    const [matchPause, setMatchPause] = useState<MatchPauseInfo>(null);
    const [cooldownUntil, setCooldownUntil] = useState<Record<string, number>>({});
    const [castFlashId, setCastFlashId] = useState<string | null>(null);
    const [fxBursts, setFxBursts] = useState<FxBurst[]>([]);
    const [localHp, setLocalHp] = useState({ hp: 100, maxHp: 100 });
    const [economy, setEconomy] = useState({
        copper: 0,
        silver: 0,
        gold: 0,
        essence: 0,
        loadout: [] as string[],
        talents: [] as string[],
    });
    const fxKeyRef = useRef(0);

    const seqRef = useRef(0);
    const keysRef = useRef({ up: false, down: false, left: false, right: false });
    /** Hold-to-cast for mouse slots (LMB / RMB). */
    const heldCastSlotsRef = useRef({ mouse0: false, mouse2: false });
    const yawRef = useRef(0);
    const roomRef = useRef<Room | null>(null);
    const clientRef = useRef<Client | null>(null);
    const predictorRef = useRef(new LocalPredictor());
    const predictedRef = useRef<PredictedPose>({ x: 0, z: 0, yaw: 0 });
    const pendingInteractRef = useRef<string | undefined>(undefined);
    const pendingCastRef = useRef<string | undefined>(undefined);
    const pendingCancelRef = useRef(false);
    const awaitingCastAckRef = useRef(false);
    const castingAbilityRef = useRef<string | null>(null);
    const castPhaseRef = useRef<string>("");
    const cooldownUntilRef = useRef<Record<string, number>>({});
    const loadoutRef = useRef<string[]>([]);
    const castFlashTimerRef = useRef(0);
    const sessionIdRef = useRef<string | null>(null);
    const lastHudUpdate = useRef(0);
    const lastAckRef = useRef(-1);
    const inputLockedRef = useRef(Boolean(options.inputLocked));
    const matchPauseRef = useRef<MatchPauseInfo>(null);
    const activeUiRef = useRef<ActiveUi>(null);
    const transferringRef = useRef(false);
    const phaseRef = useRef<SessionPhase>("hub");
    const reconnectingRef = useRef(false);
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const [localPlayer, setLocalPlayer] = useState<{ x: number; z: number } | null>(null);

    const showToast = useCallback((message: string) => {
        setToast(message);
        window.setTimeout(() => setToast(null), 2500);
    }, []);

    const applyTransferRef = useRef<(msg: TransferMsg) => Promise<void>>(async () => undefined);
    const tryContentReconnectRef = useRef<(code?: number) => Promise<boolean>>(async () => false);

    const persistRejoinToken = useCallback((joined: Room, mode: string | null) => {
        const token = (joined as Room & { reconnectionToken?: string }).reconnectionToken;
        if (!token) return;
        const opts = optionsRef.current;
        saveContentRejoin({
            token,
            roomId: joined.roomId,
            mode,
            hubOwnerId: opts.hubOwnerId ?? opts.userId,
        });
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
            setActiveUi(null);
            setMatchPause(null);
            setFxBursts([]);
            predictorRef.current = new LocalPredictor();
            lastAckRef.current = -1;
            seqRef.current = 0;

            if (nextPhase === "content") {
                persistRejoinToken(joined, mode ?? null);
            } else {
                clearContentRejoin();
            }

            joined.onMessage("toast", (msg: { message: string }) => {
                showToast(msg.message);
            });

            joined.onMessage("ui", (msg: { ui: Exclude<ActiveUi, null> }) => {
                setActiveUi(msg.ui);
            });

            joined.onMessage("queue_status", (msg: { queued: boolean; modes?: string[] }) => {
                if (msg.queued) {
                    setPhase("queued");
                    phaseRef.current = "queued";
                    setQueueModes(msg.modes ?? []);
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
                (msg: { resources?: Record<string, number>; loadout?: string[]; talents?: string[] }) => {
                    setEconomy({
                        copper: msg.resources?.copper ?? 0,
                        silver: msg.resources?.silver ?? 0,
                        gold: msg.resources?.gold ?? 0,
                        essence: msg.resources?.essence ?? 0,
                        loadout: msg.loadout ?? [],
                        talents: msg.talents ?? [],
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
                "combat_fx",
                (msg: {
                    kind: "aoe" | "melee" | "dash" | "hit" | "cast_phase";
                    abilityId: string;
                    x: number;
                    z: number;
                    radius?: number;
                    ownerId?: string;
                    phase?: "anticipation" | "cast" | "impact" | "recovery" | "cancel" | "interrupt" | "idle";
                    phaseEndsAt?: number;
                }) => {
                    const isLocal = msg.ownerId === sessionIdRef.current;

                    if (msg.kind === "cast_phase") {
                        if (isLocal) {
                            awaitingCastAckRef.current = false;
                            const ended =
                                msg.phase === "idle" ||
                                msg.phase === "cancel" ||
                                msg.phase === "interrupt";
                            castPhaseRef.current = ended ? "" : (msg.phase ?? "");
                            castingAbilityRef.current = ended ? null : msg.abilityId;
                            predictorRef.current.setMoveMulFromPhase(
                                ended ? undefined : msg.abilityId,
                                ended ? undefined : msg.phase,
                            );

                            // Effect + CD + travel start at impact (projectile near full extension)
                            if (msg.phase === "impact") {
                                const def = ABILITIES[msg.abilityId];
                                if (def) {
                                    const until = Date.now() + def.cooldownMs;
                                    cooldownUntilRef.current = {
                                        ...cooldownUntilRef.current,
                                        [msg.abilityId]: until,
                                    };
                                    setCooldownUntil(cooldownUntilRef.current);
                                    predictorRef.current.beginTravelFromCast(
                                        msg.abilityId,
                                        yawRef.current,
                                    );
                                }
                            }
                            if (ended) {
                                // interrupt: keep flying projectiles; only clear local cast/travel anim
                                predictorRef.current.clearTravel();
                            }
                        }
                        return;
                    }

                    const key = ++fxKeyRef.current;
                    const life = msg.kind === "hit" ? 280 : msg.kind === "dash" ? 220 : 450;
                    const burst: FxBurst = {
                        key,
                        kind: msg.kind,
                        x: msg.x,
                        z: msg.z,
                        radius: msg.radius ?? (msg.kind === "hit" ? 0.7 : 2.2),
                        born: performance.now(),
                        life,
                        color: FX_COLORS[msg.kind],
                    };
                    setFxBursts((prev) => [...prev.filter((b) => performance.now() - b.born < b.life), burst]);
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
                    return;
                }
                syncPauseFromState(state);
            });
            state.listen?.("pauseReason", () => {
                if (state.paused) syncPauseFromState(state);
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
        [persistRejoinToken, showToast],
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
                const rejoined = await client.reconnect(saved.token);
                wireRoom(rejoined, "content", saved.mode);
                showToast("Back in match");
                return true;
            } catch (err) {
                console.warn("content reconnect failed", err);
                clearContentRejoin();
                showToast("Could not reconnect — returning to city");
                try {
                    const opts = optionsRef.current;
                    const hub = await client.joinOrCreate(ROOM.BASE_CITY, {
                        userId: opts.userId,
                        displayName: opts.displayName,
                        color: opts.color,
                        accessToken: opts.accessToken ?? undefined,
                        hubOwnerId: saved.hubOwnerId || opts.hubOwnerId || opts.userId,
                    });
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
                await roomRef.current?.leave(true);
                roomRef.current = null;
                setRoom(null);

                const hubOwnerId =
                    (msg.options?.hubOwnerId as string | undefined) ?? opts.hubOwnerId ?? opts.userId;

                const joinOpts: Record<string, unknown> = {
                    userId: opts.userId,
                    displayName: opts.displayName,
                    color: opts.color,
                    accessToken: opts.accessToken ?? undefined,
                    hubOwnerId,
                    mode: msg.options?.mode,
                    modifiers: msg.options?.modifiers,
                    matchId: msg.options?.matchId,
                };

                const joined = msg.roomId
                    ? await client.joinById(msg.roomId, joinOpts)
                    : await client.joinOrCreate(msg.room, joinOpts);
                const nextPhase: SessionPhase = msg.room === ROOM.BASE_CITY ? "hub" : "content";
                const mode = typeof msg.options?.mode === "string" ? msg.options.mode : null;
                wireRoom(joined, nextPhase, mode);
                if (nextPhase === "hub") {
                    setQueueModes([]);
                    clearContentRejoin();
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
        const locked = Boolean(options.inputLocked) || activeUi !== null || Boolean(matchPause);
        inputLockedRef.current = locked;
        activeUiRef.current = activeUi;
        matchPauseRef.current = matchPause;
        if (locked) {
            keysRef.current = { up: false, down: false, left: false, right: false };
            heldCastSlotsRef.current = { mouse0: false, mouse2: false };
            pendingCastRef.current = undefined;
        }
    }, [options.inputLocked, activeUi, matchPause]);

    useEffect(() => {
        loadoutRef.current = normalizeLoadout(economy.loadout);
    }, [economy.loadout]);

    const queueCastFromSlotInput = useCallback((slotInput: "mouse0" | "mouse2" | "space" | "q" | "e" | "r") => {
        if (inputLockedRef.current) return;
        const idx = slotIndexForInput(slotInput);
        if (idx < 0) return;
        const loadout = loadoutRef.current;
        const abilityId = loadout[idx];
        if (!abilityId) return;
        const def = ABILITIES[abilityId];
        if (!def) return;
        const now = Date.now();
        if ((cooldownUntilRef.current[abilityId] ?? 0) > now) return;
        if (pendingCastRef.current) return;

        const currentId = castingAbilityRef.current;
        const current = currentId ? ABILITIES[currentId] : null;
        const busy = Boolean(castPhaseRef.current);
        if (busy) {
            // Already casting this spell — wait for recovery (hold-to-cast retries next frame)
            if (currentId === abilityId) return;
            const canCut = def.interruptsOtherCasts === true && current?.interruptible !== false;
            if (!canCut && (current?.timing.blocksOtherCasts !== false || def.timing.blocksOtherCasts !== false)) {
                return;
            }
            if (canCut) {
                // Optimistic: drop local cast anim; server soft-interrupts and starts this ability
                castPhaseRef.current = "";
                castingAbilityRef.current = null;
                predictorRef.current.clearTravel();
                predictorRef.current.setMoveMulFromPhase(undefined, undefined);
            }
        }

        pendingCastRef.current = abilityId;
        awaitingCastAckRef.current = true;
        castPhaseRef.current = "anticipation";
        castingAbilityRef.current = abilityId;
        predictorRef.current.setMoveMulFromPhase(abilityId, "anticipation");
        setCastFlashId(abilityId);
        window.clearTimeout(castFlashTimerRef.current);
        castFlashTimerRef.current = window.setTimeout(() => setCastFlashId(null), 120);
    }, []);

    const queueCancelCast = useCallback(() => {
        if (inputLockedRef.current) return;
        if (castPhaseRef.current !== "anticipation") return;
        pendingCancelRef.current = true;
        awaitingCastAckRef.current = false;
        // Optimistic local clear; server confirms via cast_phase cancel
        castPhaseRef.current = "";
        castingAbilityRef.current = null;
        predictorRef.current.setMoveMulFromPhase(undefined, undefined);
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent, down: boolean) => {
            if (inputLockedRef.current) return;
            if (e.repeat && down) return;
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
                    if (down) window.dispatchEvent(new CustomEvent("bb-interact"));
                    break;
                case "Space":
                    if (down) {
                        e.preventDefault();
                        queueCastFromSlotInput("space");
                    }
                    break;
                case "KeyQ":
                    if (down) {
                        e.preventDefault();
                        queueCastFromSlotInput("q");
                    }
                    break;
                case "KeyE":
                    if (down) {
                        e.preventDefault();
                        queueCastFromSlotInput("e");
                    }
                    break;
                case "KeyR":
                    if (down) {
                        e.preventDefault();
                        queueCastFromSlotInput("r");
                    }
                    break;
                case "KeyC":
                case "Escape":
                    if (down) {
                        e.preventDefault();
                        queueCancelCast();
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
    }, [queueCastFromSlotInput, queueCancelCast]);

    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            if (inputLockedRef.current) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest?.("[data-ui-overlay]")) return;
            if (e.button === 0) {
                heldCastSlotsRef.current.mouse0 = true;
                queueCastFromSlotInput("mouse0");
            } else if (e.button === 2) {
                e.preventDefault();
                heldCastSlotsRef.current.mouse2 = true;
                queueCastFromSlotInput("mouse2");
            }
        };
        const onMouseUp = (e: MouseEvent) => {
            if (e.button === 0) heldCastSlotsRef.current.mouse0 = false;
            if (e.button === 2) heldCastSlotsRef.current.mouse2 = false;
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
        window.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mouseup", onMouseUp);
        window.addEventListener("blur", clearHeld);
        window.addEventListener("contextmenu", onContextMenu);
        return () => {
            window.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mouseup", onMouseUp);
            window.removeEventListener("blur", clearHeld);
            window.removeEventListener("contextmenu", onContextMenu);
        };
    }, [queueCastFromSlotInput]);

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
        setMatchPause(null);

        (async () => {
            try {
                const saved = loadContentRejoin();
                if (saved?.token) {
                    try {
                        const rejoined = await client.reconnect(saved.token);
                        if (cancelled) {
                            rejoined.leave();
                            return;
                        }
                        wireRoom(rejoined, "content", saved.mode);
                        showToast("Rejoined match");
                        return;
                    } catch {
                        clearContentRejoin();
                    }
                }

                const hubOwnerId = options.hubOwnerId ?? options.userId;
                const joined = await client.joinOrCreate(ROOM.BASE_CITY, {
                    userId: options.userId,
                    displayName: options.displayName,
                    color: options.color,
                    accessToken: options.accessToken ?? undefined,
                    hubOwnerId,
                });
                if (cancelled) {
                    joined.leave();
                    return;
                }
                wireRoom(joined, "hub", null);
            } catch (err) {
                console.error(err);
                if (!cancelled) setStatus("error");
            }
        })();

        return () => {
            cancelled = true;
            transferringRef.current = false;
            roomRef.current?.leave();
            roomRef.current = null;
            clientRef.current = null;
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

    useEffect(() => {
        let raf = 0;
        let last = performance.now();

        const onInteractRequest = (e: Event) => {
            const detail = (e as CustomEvent<string>).detail;
            if (detail) pendingInteractRef.current = detail;
        };
        window.addEventListener("bb-send-interact", onInteractRequest as EventListener);

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
                          castPhase?: string;
                          castAbilityId?: string;
                      }
                    | undefined;

                const playersMap = r.state?.players as
                    | Map<string, { x: number; z: number; disconnected?: boolean; hp?: number }>
                    | undefined;
                if (playersMap) {
                    const dynamics = playerCollidersExcept(
                        playersMap.entries(),
                        r.sessionId,
                    );
                    const statics =
                        phaseRef.current === "hub" ? baseCityStaticColliders() : [];
                    predictor.setWorldColliders(statics, dynamics);
                }

                if (serverMe && !predictor.isSeeded) {
                    predictor.seed(serverMe.x, serverMe.z, serverMe.yaw);
                    predictedRef.current = { ...predictor.state };
                    lastAckRef.current = serverMe.lastInputSeq;
                }

                if (serverMe) {
                    if (serverMe.castPhase) {
                        castPhaseRef.current = serverMe.castPhase;
                        castingAbilityRef.current = serverMe.castAbilityId || null;
                        awaitingCastAckRef.current = false;
                        predictor.setMoveMulFromPhase(serverMe.castAbilityId, serverMe.castPhase);
                    } else if (!pendingCastRef.current && !awaitingCastAckRef.current) {
                        castPhaseRef.current = "";
                        castingAbilityRef.current = null;
                        predictor.setMoveMulFromPhase(undefined, undefined);
                    }
                }

                if (serverMe && predictor.isSeeded && serverMe.lastInputSeq !== lastAckRef.current) {
                    lastAckRef.current = serverMe.lastInputSeq;
                    predictor.reconcile(serverMe);
                    predictedRef.current = { ...predictor.state };
                }

                const keys = keysRef.current;
                let moveX = 0;
                let moveZ = 0;
                if (keys.right) moveX += 1;
                if (keys.left) moveX -= 1;
                if (keys.down) moveZ += 1;
                if (keys.up) moveZ -= 1;

                // Hold-to-cast: re-fire as soon as CD + cast lock allow
                if (heldCastSlotsRef.current.mouse0) queueCastFromSlotInput("mouse0");
                if (heldCastSlotsRef.current.mouse2) queueCastFromSlotInput("mouse2");

                if (predictor.isSeeded) {
                    seqRef.current += 1;
                    const castId = pendingCastRef.current;
                    pendingCastRef.current = undefined;
                    const cancelCast = pendingCancelRef.current;
                    pendingCancelRef.current = false;
                    const input: PlayerInput = {
                        seq: seqRef.current,
                        dt,
                        moveX,
                        moveZ,
                        yaw: yawRef.current,
                        castId,
                        cancelCast: cancelCast || undefined,
                        interactId: pendingInteractRef.current,
                    };
                    pendingInteractRef.current = undefined;

                    const predicted = predictor.predict(input);
                    predictedRef.current = predicted;
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
                          }
                        | undefined;
                    if (me && typeof me.copper === "number") {
                        setEconomy((prev) => ({
                            copper: me.copper ?? prev.copper,
                            silver: me.silver ?? prev.silver,
                            gold: me.gold ?? prev.gold,
                            essence: me.essence ?? prev.essence,
                            loadout: me.loadout ? me.loadout.split(",").filter(Boolean) : prev.loadout,
                            talents: me.talents ? me.talents.split(",").filter(Boolean) : prev.talents,
                        }));
                    }
                    if (me && typeof me.hp === "number") {
                        setLocalHp({ hp: me.hp, maxHp: me.maxHp ?? 100 });
                    }
                }
            }

            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("bb-send-interact", onInteractRequest as EventListener);
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
        roomRef.current?.send("return_hub");
    }, []);

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
        matchPause,
        cooldownUntil,
        castFlashId,
        fxBursts,
        localHp,
    };
}
