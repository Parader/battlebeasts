import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import {
  COMBAT_ENGAGE_LINGER_MS,
  ENERGY_MAX_PIPS,
  PLAYER_BASE_MAX_HP,
  energyPips,
  totalShieldAbsorb,
} from "@battlebeasts/shared";
import {
  StatusHpBadgeStack,
  readBleedingBadge,
  readBurningBadge,
  readPoisonBadge,
  readRejuvenationBadge,
  readSilenceBadge,
  readHolyBadge,
  syncBleedingBadge,
  syncBurningBadge,
  syncPoisonBadge,
  syncRejuvenationBadge,
  syncSilenceBadge,
  syncHolyBadge,
  type StatusRowLite,
} from "./StatusHpBadgeStack";
import { isRevengeVanished } from "./revengeVanishRuntime";

/** Pip strip spans the HP bar's 1.05 width, with a hairline gap between pips. */
const PIP_PITCH = 1.05 / ENERGY_MAX_PIPS;
const PIP_W = PIP_PITCH - 0.015;

type Props = {
  room: Room | null;
  sessionId: string | null;
  /** Height above the character root. */
  y?: number;
  /**
   * When true, show whenever alive and not stealthed (PvP enemies).
   * Default keeps hub/self bars gated to combat engage to reduce clutter.
   */
  alwaysVisible?: boolean;
  /** HP fill color (ally green / enemy red). */
  fillColor?: string;
};

/**
 * Camera-facing HP (+ optional shield) bar above a player.
 * Visible while in combat (damaged / casting / DoT / linger); hidden out of combat.
 * Pass `alwaysVisible` for opposing players so enemies stay readable in fights.
 */
export function PlayerHpBillboard({
  room,
  sessionId,
  y = 2.2,
  alwaysVisible = false,
  fillColor = "#4ade80",
}: Props) {
  const root = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);
  const fillMat = useRef<THREE.MeshBasicMaterial>(null);
  const shield = useRef<THREE.Mesh>(null);
  const energyRow = useRef<THREE.Group>(null);
  const energyFills = useRef<(THREE.Mesh | null)[]>([]);
  const poisonBadge = useRef<HTMLDivElement>(null);
  const poisonStacksEl = useRef<HTMLSpanElement>(null);
  const poisonRing = useRef<SVGCircleElement>(null);
  const burningBadge = useRef<HTMLDivElement>(null);
  const burningRing = useRef<SVGCircleElement>(null);
  const bleedingBadge = useRef<HTMLDivElement>(null);
  const bleedingStacksEl = useRef<HTMLSpanElement>(null);
  const bleedingRing = useRef<SVGCircleElement>(null);
  const rejuvenationBadge = useRef<HTMLDivElement>(null);
  const rejuvenationStacksEl = useRef<HTMLSpanElement>(null);
  const rejuvenationRing = useRef<SVGCircleElement>(null);
  const silenceBadge = useRef<HTMLDivElement>(null);
  const silenceRing = useRef<SVGCircleElement>(null);
  const holyBadge = useRef<HTMLDivElement>(null);
  const holyRing = useRef<SVGCircleElement>(null);
  const lingerUntil = useRef(0);
  const prevHp = useRef<number | null>(null);
  const lastFillColor = useRef(fillColor);
  const lastPoisonStacks = useRef(0);
  const lastBleedingStacks = useRef(0);
  const lastRejuvenationStacks = useRef(0);

  useFrame(() => {
    const g = root.current;
    const m = fill.current;
    const s = shield.current;
    const badge = poisonBadge.current;
    const burnBadge = burningBadge.current;
    const bleedBadge = bleedingBadge.current;
    const rejBadge = rejuvenationBadge.current;
    const silBadge = silenceBadge.current;
    const hlyBadge = holyBadge.current;
    if (!g || !m || !sessionId || !room) {
      if (g) g.visible = false;
      if (badge) badge.style.display = "none";
      if (burnBadge) burnBadge.style.display = "none";
      if (bleedBadge) bleedBadge.style.display = "none";
      if (rejBadge) rejBadge.style.display = "none";
      if (silBadge) silBadge.style.display = "none";
      if (hlyBadge) hlyBadge.style.display = "none";
      return;
    }
    const p = room.state?.players?.get(sessionId) as
      | {
          hp?: number;
          maxHp?: number;
          energy?: number;
          castPhase?: string;
          disconnected?: boolean;
          statuses?: {
            forEach: (cb: (row: StatusRowLite) => void) => void;
          };
        }
      | undefined;
    if (!p || p.disconnected || typeof p.hp !== "number" || p.hp <= 0) {
      g.visible = false;
      if (badge) badge.style.display = "none";
      if (burnBadge) burnBadge.style.display = "none";
      if (bleedBadge) bleedBadge.style.display = "none";
      if (rejBadge) rejBadge.style.display = "none";
      if (silBadge) silBadge.style.display = "none";
      if (hlyBadge) hlyBadge.style.display = "none";
      prevHp.current = p?.hp ?? null;
      lastPoisonStacks.current = 0;
      lastBleedingStacks.current = 0;
      lastRejuvenationStacks.current = 0;
      return;
    }

    let revengePhased = false;
    let cloaked = false;
    p.statuses?.forEach((row) => {
      if (row?.statusId === "revengePhased") revengePhased = true;
      if (row?.statusId === "cloaked") cloaked = true;
    });
    if (isRevengeVanished(sessionId) || revengePhased || cloaked) {
      g.visible = false;
      if (badge) badge.style.display = "none";
      if (burnBadge) burnBadge.style.display = "none";
      if (bleedBadge) bleedBadge.style.display = "none";
      if (rejBadge) rejBadge.style.display = "none";
      if (silBadge) silBadge.style.display = "none";
      if (hlyBadge) hlyBadge.style.display = "none";
      return;
    }

    const maxHp = Math.max(1, p.maxHp ?? PLAYER_BASE_MAX_HP);
    const ratio = Math.max(0, Math.min(1, p.hp / maxHp));
    const rows: StatusRowLite[] = [];
    p.statuses?.forEach((row) => {
      if (row?.statusId) rows.push(row);
    });
    const shieldAmt = totalShieldAbsorb(rows);
    const shieldRatio = Math.max(0, Math.min(1, shieldAmt / maxHp));
    const casting = Boolean(p.castPhase);
    const damaged = p.hp < maxHp - 0.05;
    const now = performance.now();
    const poison = readPoisonBadge(rows);
    const burning = readBurningBadge(rows);
    const bleeding = readBleedingBadge(rows);
    const rejuvenation = readRejuvenationBadge(rows);
    const silence = readSilenceBadge(rows);
    const holy = readHolyBadge(rows);
    const poisoned = poison.stacks > 0;
    const isBurning = burning.stacks > 0;
    const isBleeding = bleeding.stacks > 0;
    const rejuvenating = rejuvenation.stacks > 0;
    const isSilenced = silence.stacks > 0;
    const isHoly = holy.stacks > 0;

    if (prevHp.current != null && p.hp < prevHp.current - 0.05) {
      lingerUntil.current = now + COMBAT_ENGAGE_LINGER_MS;
    }
    prevHp.current = p.hp;

    if (
      damaged ||
      shieldRatio > 0 ||
      casting ||
      poisoned ||
      isBurning ||
      isBleeding ||
      rejuvenating ||
      isSilenced ||
      isHoly
    ) {
      lingerUntil.current = now + COMBAT_ENGAGE_LINGER_MS;
    }

    const show =
      alwaysVisible ||
      damaged ||
      shieldRatio > 0 ||
      casting ||
      poisoned ||
      isBurning ||
      isBleeding ||
      rejuvenating ||
      isSilenced ||
      isHoly ||
      now < lingerUntil.current;

    g.visible = show;
    if (!show) {
      if (badge) badge.style.display = "none";
      if (burnBadge) burnBadge.style.display = "none";
      if (bleedBadge) bleedBadge.style.display = "none";
      if (rejBadge) rejBadge.style.display = "none";
      if (silBadge) silBadge.style.display = "none";
      if (hlyBadge) hlyBadge.style.display = "none";
      lastPoisonStacks.current = 0;
      lastBleedingStacks.current = 0;
      lastRejuvenationStacks.current = 0;
      return;
    }

    m.scale.x = Math.max(0.001, ratio);
    m.position.x = -0.5 * (1 - ratio);

    if (s) {
      if (shieldRatio <= 0) {
        s.visible = false;
      } else {
        s.visible = true;
        s.scale.x = Math.max(0.001, shieldRatio);
        const left = Math.min(ratio, Math.max(0, 1 - shieldRatio));
        s.position.x = -0.5 + left + shieldRatio * 0.5;
      }
    }

    syncPoisonBadge(badge, poisonStacksEl.current, poisonRing.current, poison, lastPoisonStacks);
    syncBurningBadge(burnBadge, burningRing.current, burning);
    syncBleedingBadge(
      bleedBadge,
      bleedingStacksEl.current,
      bleedingRing.current,
      bleeding,
      lastBleedingStacks,
    );
    syncRejuvenationBadge(
      rejBadge,
      rejuvenationStacksEl.current,
      rejuvenationRing.current,
      rejuvenation,
      lastRejuvenationStacks,
    );
    syncSilenceBadge(silBadge, silenceRing.current, silence);
    syncHolyBadge(hlyBadge, holyRing.current, holy);

    // Whole pips only up here. A partial sliver is unreadable at nameplate
    // size, and the question this bar answers is "what can they afford".
    const pips = energyPips(p.energy ?? 0);
    if (energyRow.current) energyRow.current.visible = pips > 0;
    for (let i = 0; i < ENERGY_MAX_PIPS; i++) {
      const m = energyFills.current[i];
      if (m) m.visible = i < pips;
    }

    const mat = fillMat.current;
    if (mat && lastFillColor.current !== fillColor) {
      lastFillColor.current = fillColor;
      mat.color.set(fillColor);
    }
  });

  return (
    <Billboard position={[0, y, 0]} follow renderOrder={1000}>
      <group ref={root} visible={false} renderOrder={1000}>
        <mesh renderOrder={1000}>
          <planeGeometry args={[1.05, 0.08]} />
          <meshBasicMaterial
            color="#111827"
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={fill} position={[0, 0, 0.01]} renderOrder={1001}>
          <planeGeometry args={[1, 0.055]} />
          <meshBasicMaterial
            ref={fillMat}
            color={fillColor}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={shield} position={[0, 0, 0.02]} visible={false} renderOrder={1002}>
          <planeGeometry args={[1, 0.055]} />
          <meshBasicMaterial
            color="#60a5fa"
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        {/* Energy sits under the HP bar rather than on a separate frame: an
            opponent's pips are a read you make while aiming at them, so they
            have to be where you are already looking. */}
        <group ref={energyRow} position={[0, -0.075, 0.01]} renderOrder={1002}>
          {Array.from({ length: ENERGY_MAX_PIPS }, (_, i) => (
            <mesh
              key={i}
              position={[(i - (ENERGY_MAX_PIPS - 1) / 2) * PIP_PITCH, 0, 0]}
              renderOrder={1002}
            >
              <planeGeometry args={[PIP_W, 0.022]} />
              <meshBasicMaterial
                color="#1f2937"
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          ))}
          {Array.from({ length: ENERGY_MAX_PIPS }, (_, i) => (
            <mesh
              key={`f${i}`}
              ref={(m) => {
                energyFills.current[i] = m;
              }}
              position={[(i - (ENERGY_MAX_PIPS - 1) / 2) * PIP_PITCH, 0, 0.005]}
              visible={false}
              renderOrder={1003}
            >
              <planeGeometry args={[PIP_W, 0.022]} />
              <meshBasicMaterial
                color="#fbbf24"
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          ))}
        </group>
        <StatusHpBadgeStack
          poisonBadgeRef={poisonBadge}
          poisonStacksRef={poisonStacksEl}
          poisonRingRef={poisonRing}
          burningBadgeRef={burningBadge}
          burningRingRef={burningRing}
          bleedingBadgeRef={bleedingBadge}
          bleedingStacksRef={bleedingStacksEl}
          bleedingRingRef={bleedingRing}
          rejuvenationBadgeRef={rejuvenationBadge}
          rejuvenationStacksRef={rejuvenationStacksEl}
          rejuvenationRingRef={rejuvenationRing}
          silenceBadgeRef={silenceBadge}
          silenceRingRef={silenceRing}
          holyBadgeRef={holyBadge}
          holyRingRef={holyRing}
        />
      </group>
    </Billboard>
  );
}
