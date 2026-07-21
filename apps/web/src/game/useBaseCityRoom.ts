import { useCallback, useEffect, useRef, useState } from "react";
import { Client, Room } from "colyseus.js";
import { ROOM, type PlayerInput } from "@battlebeasts/shared";
import { LocalPredictor } from "./LocalPredictor";

export type ActiveUi =
    | "customization"
    | "build"
    | "talent"
    | "shop"
    | "portal_pvp"
    | "portal_pve"
    | null;

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
    enabled?: boolean;
};

/** Shared mutable pose read by the R3F scene every frame (no React re-renders). */
export type GameNetApi = {
    room: Room | null;
    predicted: PredictedPose;
    setYaw: (yaw: number) => void;
    sendInteract: (interactId: string) => void;
};

export function useBaseCityRoom(options: Options) {
    const [status, setStatus] = useState<"connecting" | "connected" | "error" | "disconnected">("connecting");
    const [toast, setToast] = useState<string | null>(null);
    const [activeUi, setActiveUi] = useState<ActiveUi>(null);
    const [room, setRoom] = useState<Room | null>(null);

    const seqRef = useRef(0);
    const keysRef = useRef({ up: false, down: false, left: false, right: false });
    const yawRef = useRef(0);
    const roomRef = useRef<Room | null>(null);
    const predictorRef = useRef(new LocalPredictor());
    const predictedRef = useRef<PredictedPose>({ x: 0, z: 0, yaw: 0 });
    const pendingInteractRef = useRef<string | undefined>(undefined);
    const lastHudUpdate = useRef(0);
    const lastAckRef = useRef(-1);
    const [localPlayer, setLocalPlayer] = useState<{ x: number; z: number } | null>(null);

    useEffect(() => {
        if (options.enabled === false) return;

        let cancelled = false;
        const client = new Client(options.endpoint);
        predictorRef.current = new LocalPredictor();

        (async () => {
            try {
                const joined = await client.joinOrCreate(ROOM.BASE_CITY, {
                    userId: options.userId,
                    displayName: options.displayName,
                    color: options.color,
                    accessToken: options.accessToken ?? undefined,
                });
                if (cancelled) {
                    joined.leave();
                    return;
                }
                roomRef.current = joined;
                setRoom(joined);
                setStatus("connected");

                joined.onMessage("toast", (msg: { message: string }) => {
                    setToast(msg.message);
                    window.setTimeout(() => setToast(null), 2500);
                });

                joined.onMessage("ui", (msg: { ui: Exclude<ActiveUi, null> }) => {
                    setActiveUi(msg.ui);
                });

                joined.onLeave(() => {
                    setStatus("disconnected");
                    setRoom(null);
                    roomRef.current = null;
                });
            } catch (err) {
                console.error(err);
                if (!cancelled) setStatus("error");
            }
        })();

        return () => {
            cancelled = true;
            roomRef.current?.leave();
            roomRef.current = null;
        };
    }, [
        options.endpoint,
        options.userId,
        options.displayName,
        options.color,
        options.accessToken,
        options.enabled,
    ]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent, down: boolean) => {
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
                case "KeyE":
                    if (down) window.dispatchEvent(new CustomEvent("bb-interact"));
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
    }, []);

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
                    | { x: number; z: number; yaw: number; lastInputSeq: number }
                    | undefined;

                if (serverMe && !predictor.isSeeded) {
                    predictor.seed(serverMe.x, serverMe.z, serverMe.yaw);
                    predictedRef.current = { ...predictor.state };
                    lastAckRef.current = serverMe.lastInputSeq;
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

                if (predictor.isSeeded) {
                    seqRef.current += 1;
                    const input: PlayerInput = {
                        seq: seqRef.current,
                        dt,
                        moveX,
                        moveZ,
                        yaw: yawRef.current,
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
    };
}
