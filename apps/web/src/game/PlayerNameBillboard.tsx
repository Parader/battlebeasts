import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Room } from "colyseus.js";
import { hasStatusId } from "./statusBadgeUtils";

type Props = {
  room: Room | null;
  sessionId: string | null;
  /** Height above the character root (above the HP bar). */
  y?: number;
};

/**
 * Camera-projected display name above other hunters (sits above the HP bar).
 * Hidden while cloaked — Html ignores parent mesh visibility.
 */
export function PlayerNameBillboard({ room, sessionId, y = 3.2 }: Props) {
  const label = useRef<HTMLDivElement>(null);
  const lastName = useRef("");

  useFrame(() => {
    const el = label.current;
    if (!el || !sessionId || !room) {
      if (el) el.style.visibility = "hidden";
      return;
    }
    const p = room.state?.players?.get(sessionId) as
      | {
          displayName?: string;
          hp?: number;
          disconnected?: boolean;
          respawnAt?: number;
          statuses?: Parameters<typeof hasStatusId>[0];
        }
      | undefined;
    const dead = typeof p?.hp === "number" && p.hp <= 0;
    const respawnLeft =
      dead && typeof p?.respawnAt === "number" && p.respawnAt > 0
        ? Math.max(0, Math.ceil((p.respawnAt - Date.now()) / 1000))
        : 0;
    const showRespawn = dead && respawnLeft > 0;
    if (
      !p ||
      p.disconnected ||
      (dead && !showRespawn) ||
      hasStatusId(p.statuses, "cloaked") ||
      hasStatusId(p.statuses, "revengePhased")
    ) {
      el.style.visibility = "hidden";
      return;
    }
    el.style.visibility = "visible";
    const name = (p.displayName ?? "").trim() || "Hunter";
    const next = showRespawn ? `${name} · ${respawnLeft}s` : name;
    if (next !== lastName.current) {
      lastName.current = next;
      el.textContent = next;
    }
  });

  return (
    <Html
      position={[0, y, 0]}
      center
      style={{ pointerEvents: "none" }}
      zIndexRange={[20, 0]}
    >
      <div ref={label} className="bb-nameplate" style={{ visibility: "hidden" }} />
    </Html>
  );
}
