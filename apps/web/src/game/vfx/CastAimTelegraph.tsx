import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CAST_AIM_COLOR, CAST_AIM_HOT, castAimRuntime } from "../castAimRuntime";
import { getGroundAim } from "../groundAimRuntime";
import { getWorldStaticColliders } from "../worldCollidersRuntime";
import { AoeRimMarker } from "./components/AoeRimMarker";
import { CastAimReticle } from "./components/CastAimReticle";
import { GroundMagicCircle } from "./components/GroundMagicCircle";
import {
  castPreviewKindFor,
  resolveCastPreview,
  type CastPreview,
  type CastPreviewKind,
} from "./castAimPreview";
import { ABILITIES } from "@battlebeasts/shared";

type CastLite = {
  castAbilityId?: string;
  castPhase?: string;
  castComboHit?: number;
};

const Y = 0.032;
/** Thin LoL/Battlerite-style rim (shared across all shapes). */
const RIM = {
  fill: 0.16,
  rimWidth: 0.009,
  glowWidth: 0.028,
  noise: 0.05,
  opacity: 0.42,
} as const;

const RANGE_RING_OK = CAST_AIM_COLOR;
const RANGE_RING_OOR = "#ef4444";

function emptyPreview(abilityId: string): CastPreview {
  return {
    kind: "none",
    abilityId,
    color: CAST_AIM_COLOR,
    rangeRing: 0,
    rangeRingOutOfRange: false,
    feetRadius: 0,
    halfAngle: 0.7,
    aimX: 0,
    aimZ: 0,
    aimRadius: 0,
    midX: 0,
    midZ: 0,
    yaw: 0,
    length: 0,
    halfWidth: 0,
    lineEndX: 0,
    lineEndZ: 0,
    curveLeft: [],
    curveRight: [],
  };
}

const MAGMA_CURVE_CAP = 64;

function writeCurvePositions(
  flatXZ: number[],
  attr: THREE.BufferAttribute,
  y: number,
): number {
  const maxPts = Math.min(Math.floor(flatXZ.length / 2), attr.count);
  for (let i = 0; i < maxPts; i++) {
    attr.setXYZ(i, flatXZ[i * 2]!, y, flatXZ[i * 2 + 1]!);
  }
  // Degenerate-fill unused verts so drawRange can shrink cleanly.
  if (maxPts > 0) {
    const lx = flatXZ[(maxPts - 1) * 2]!;
    const lz = flatXZ[(maxPts - 1) * 2 + 1]!;
    for (let i = maxPts; i < attr.count; i++) {
      attr.setXYZ(i, lx, y, lz);
    }
  }
  attr.needsUpdate = true;
  return maxPts;
}

/**
 * Caster-only ground aim ghost while anticipation/cast windup.
 * Unified cyan tint — LoL / Battlerite style.
 */
export function CastAimTelegraph({
  room,
  sessionId,
  getPos,
  getYaw,
}: {
  room: Room;
  sessionId: string;
  getPos: () => { x: number; z: number };
  getYaw: () => number;
}) {
  const [abilityId, setAbilityId] = useState<string | null>(null);
  const [kind, setKind] = useState<CastPreviewKind>("none");

  const feet = useRef<THREE.Group>(null);
  const aimGroup = useRef<THREE.Group>(null);
  const midGroup = useRef<THREE.Group>(null);
  const lineMesh = useRef<THREE.Mesh>(null);
  const rangeRing = useRef<THREE.Group>(null);
  const rangeRingOk = useRef<THREE.Mesh>(null);
  const rangeRingOor = useRef<THREE.Mesh>(null);
  /** 0..1 smoothed visibility for the OOR range ring. */
  const rangeRingOorFade = useRef(0);
  /** Last feet pose — keep the OOR ring planted while it fades after aim clears. */
  const lastFeetPos = useRef({ x: 0, z: 0 });
  const lastRangeRingR = useRef(8.5);
  const curveLeft = useRef<THREE.Line>(null);
  const curveRight = useRef<THREE.Line>(null);
  const previewRef = useRef<CastPreview>(emptyPreview(""));
  const opacityRef = useRef(1);

  const curveGeos = useMemo(() => {
    const mk = () => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(MAGMA_CURVE_CAP * 3);
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setDrawRange(0, 0);
      return geo;
    };
    return { left: mk(), right: mk() };
  }, []);

  const curveMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: CAST_AIM_COLOR,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      curveGeos.left.dispose();
      curveGeos.right.dispose();
      curveMat.dispose();
    };
  }, [curveGeos, curveMat]);

  useEffect(() => {
    return castAimRuntime.subscribe(() => {
      // Keep last ability mounted while runtime still holds it (e.g. impact) so
      // visibility is toggled in useFrame — avoids remount flicker on phase gaps.
      const id = castAimRuntime.abilityId;
      setAbilityId(id);
      if (id) {
        const def = ABILITIES[id];
        setKind(def ? castPreviewKindFor(def) : "none");
      } else {
        setKind("none");
      }
    });
  }, []);

  useFrame((_, delta) => {
    // Schema fallback if optimistic bus missed a frame (never after cancel).
    if (!castAimRuntime.isAimPreviewActive() && castAimRuntime.isSchemaFallbackAllowed()) {
      const p = room.state?.players?.get(sessionId) as CastLite | undefined;
      if (
        p?.castAbilityId &&
        (p.castPhase === "anticipation" ||
          p.castPhase === "cast" ||
          (p.castPhase === "impact" && p.castAbilityId === "fireball")) &&
        (p.castComboHit ?? 1) <= 1
      ) {
        // Shrooms: ghost only during anticipation (plant takes over).
        if (p.castAbilityId === "shrooms" && p.castPhase !== "anticipation") {
          /* skip */
        } else {
          castAimRuntime.set(p.castAbilityId, p.castPhase, p.castComboHit || 1);
        }
      }
    } else if (castAimRuntime.abilityId) {
      // Keep combo index in sync — hide crescent after first swing stamps hit 2+.
      const p = room.state?.players?.get(sessionId) as CastLite | undefined;
      if (p?.castComboHit && p.castComboHit > 1) {
        castAimRuntime.set(castAimRuntime.abilityId, castAimRuntime.phase, p.castComboHit);
      }
      // Drop aim ghost once the real plant / leech beam takes over.
      if (
        castAimRuntime.abilityId === "shrooms" &&
        p?.castPhase &&
        p.castPhase !== "anticipation"
      ) {
        castAimRuntime.clear();
      }
      if (castAimRuntime.abilityId === "lifeLeech" && p?.castPhase === "impact") {
        castAimRuntime.clear();
      }
    }

    const id = castAimRuntime.abilityId;
    const active = castAimRuntime.isAimPreviewActive() && Boolean(id && ABILITIES[id]);

    const tickOorFade = (wantOor: boolean) => {
      const fadeSpeed = wantOor ? 6 : 3.2;
      const fadeTarget = wantOor ? 1 : 0;
      rangeRingOorFade.current +=
        (fadeTarget - rangeRingOorFade.current) * Math.min(1, delta * fadeSpeed);
      if (Math.abs(rangeRingOorFade.current - fadeTarget) < 0.002) {
        rangeRingOorFade.current = fadeTarget;
      }
      const oorFade = rangeRingOorFade.current;
      if (rangeRingOor.current) {
        const oorMat = rangeRingOor.current.material as THREE.MeshBasicMaterial;
        const pulse = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(performance.now() * 0.0042));
        oorMat.opacity = 0.26 * pulse * oorFade;
        rangeRingOor.current.visible = oorFade > 0.01;
      }
      return oorFade;
    };

    if (!active || !id) {
      if (aimGroup.current) aimGroup.current.visible = false;
      if (midGroup.current) midGroup.current.visible = false;
      if (lineMesh.current) lineMesh.current.visible = false;
      if (curveLeft.current) curveLeft.current.visible = false;
      if (curveRight.current) curveRight.current.visible = false;
      if (rangeRingOk.current) rangeRingOk.current.visible = false;

      const oorFade = tickOorFade(false);
      if (oorFade > 0.01 && rangeRing.current) {
        if (feet.current) {
          feet.current.visible = true;
          feet.current.position.set(lastFeetPos.current.x, 0, lastFeetPos.current.z);
        }
        rangeRing.current.visible = true;
        rangeRing.current.scale.set(lastRangeRingR.current, 1, lastRangeRingR.current);
      } else {
        if (feet.current) feet.current.visible = false;
        if (rangeRing.current) rangeRing.current.visible = false;
      }
      return;
    }

    const pos = getPos();
    const yaw = getYaw();
    const healables: { id: string; x: number; z: number }[] = [];
    if (id === "soulRelay") {
      const players = room.state?.players;
      players?.forEach((p, pid) => {
        if (pid === sessionId) return;
        const pl = p as {
          x?: number;
          z?: number;
          hp?: number;
          disconnected?: boolean;
          role?: string;
          roundDead?: boolean;
        };
        if (pl.disconnected || (pl.hp ?? 0) <= 0 || pl.role === "spectator" || pl.roundDead) {
          return;
        }
        if (typeof pl.x === "number" && typeof pl.z === "number") {
          healables.push({ id: pid, x: pl.x, z: pl.z });
        }
      });
      const targets = room.state?.targets;
      targets?.forEach((t, tid) => {
        const tg = t as { x?: number; z?: number; hp?: number };
        if ((tg.hp ?? 0) <= 0) return;
        if (typeof tg.x === "number" && typeof tg.z === "number") {
          healables.push({ id: tid, x: tg.x, z: tg.z });
        }
      });
    }
    const preview = resolveCastPreview({
      abilityId: id,
      color: CAST_AIM_COLOR,
      owner: { x: pos.x, z: pos.z, yaw },
      aim: getGroundAim(),
      statics: getWorldStaticColliders(),
      healables,
    });
    previewRef.current = preview;

    if (preview.kind === "none") {
      if (feet.current) feet.current.visible = false;
      if (aimGroup.current) aimGroup.current.visible = false;
      if (midGroup.current) midGroup.current.visible = false;
      if (lineMesh.current) lineMesh.current.visible = false;
      if (curveLeft.current) curveLeft.current.visible = false;
      if (curveRight.current) curveRight.current.visible = false;
      return;
    }

    if (feet.current) {
      feet.current.visible = true;
      feet.current.position.set(pos.x, 0, pos.z);
      feet.current.rotation.set(0, yaw, 0);
      lastFeetPos.current = { x: pos.x, z: pos.z };
    }

    if (rangeRing.current) {
      const r = preview.rangeRing;
      const wantRing = r > 0.05;
      if (wantRing) {
        lastRangeRingR.current = r;
        rangeRing.current.scale.set(r, 1, r);
      }

      const wantOor = wantRing && preview.rangeRingOutOfRange;
      const oorFade = tickOorFade(wantOor);
      rangeRing.current.visible = wantRing || oorFade > 0.01;

      // Never stack cyan + red — only one range ring at a time.
      if (rangeRingOk.current) {
        const okMat = rangeRingOk.current.material as THREE.MeshBasicMaterial;
        okMat.opacity = 0.32;
        rangeRingOk.current.visible = wantRing && !wantOor && oorFade < 0.02;
      }
    }

    const showAim =
      preview.kind === "placeCircle" ||
      preview.kind === "magmaOrbs" ||
      preview.kind === "blink" ||
      preview.kind === "forwardPlace" ||
      preview.kind === "allyBind" ||
      preview.kind === "selfCircle";
    if (aimGroup.current) {
      aimGroup.current.visible = showAim && (preview.kind === "blink" || preview.aimRadius > 0.05);
      if (aimGroup.current.visible) {
        aimGroup.current.position.set(preview.aimX, 0, preview.aimZ);
        if (preview.kind === "blink") {
          aimGroup.current.scale.set(1, 1, 1);
        } else {
          const s = Math.max(0.05, preview.aimRadius);
          aimGroup.current.scale.set(s, 1, s);
        }
      }
    }

    const showMid = preview.kind === "wall" || preview.kind === "line";
    if (midGroup.current) {
      midGroup.current.visible = showMid;
      if (showMid) {
        midGroup.current.position.set(preview.midX, 0, preview.midZ);
        midGroup.current.rotation.set(0, preview.yaw, 0);
      }
    }

    if (lineMesh.current) {
      const showLine =
        preview.kind === "blink" ||
        preview.kind === "forwardPlace" ||
        preview.kind === "skillshot";
      lineMesh.current.visible = showLine;
      if (showLine) {
        const endX = preview.aimX || preview.lineEndX;
        const endZ = preview.aimZ || preview.lineEndZ;
        const dx = endX - pos.x;
        const dz = endZ - pos.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) {
          lineMesh.current.visible = false;
        } else {
          lineMesh.current.position.set(pos.x + dx * 0.5, Y, pos.z + dz * 0.5);
          lineMesh.current.rotation.set(0, Math.atan2(dx, dz), 0);
          // Thin aim line (not the combat hitbox corridor).
          lineMesh.current.scale.set(0.045, 1, len);
        }
      }
    }

    const showCurves = preview.kind === "magmaOrbs";
    if (curveLeft.current && curveRight.current) {
      curveLeft.current.visible = showCurves && preview.curveLeft.length >= 4;
      curveRight.current.visible = showCurves && preview.curveRight.length >= 4;
      if (showCurves) {
        const leftAttr = curveGeos.left.getAttribute("position") as THREE.BufferAttribute;
        const rightAttr = curveGeos.right.getAttribute("position") as THREE.BufferAttribute;
        const nL = writeCurvePositions(preview.curveLeft, leftAttr, Y);
        const nR = writeCurvePositions(preview.curveRight, rightAttr, Y);
        curveGeos.left.setDrawRange(0, nL);
        curveGeos.right.setDrawRange(0, nR);
      }
    }
  });

  const show = abilityId != null && kind !== "none";

  const wallLen = useMemo(() => {
    if (!abilityId) return 8;
    const def = ABILITIES[abilityId];
    if (!def) return 8;
    if (kind === "wall") {
      const half = Math.max(1.5, (def.range > 0 ? def.range : 9) * 0.5);
      return half * 2;
    }
    if (kind === "skillshot") {
      const raw = def.range > 0 ? def.range : 12;
      return raw > 24 ? 12 : Math.max(4, raw);
    }
    return Math.max(1, def.range > 0 ? def.range : 10);
  }, [abilityId, kind]);

  const wallHalfW = useMemo(() => {
    if (!abilityId) return 0.55;
    const def = ABILITIES[abilityId];
    if (kind === "skillshot") {
      return Math.max(0.4, Math.min(1.05, def?.radius ?? 0.55));
    }
    return Math.max(0.25, def?.radius ?? 0.55);
  }, [abilityId, kind]);

  const coneLen = useMemo(() => {
    if (!abilityId) return 8;
    const def = ABILITIES[abilityId];
    return Math.max(1, def?.range ?? 8);
  }, [abilityId]);

  const coneHalf = useMemo(() => {
    if (!abilityId) return 0.7;
    if (kind === "meleeArc") return 0.85;
    const def = ABILITIES[abilityId];
    return Math.max(0.15, def?.coneHalfAngle ?? 0.7);
  }, [abilityId, kind]);

  const selfR = useMemo(() => {
    if (!abilityId) return 2;
    const def = ABILITIES[abilityId];
    return Math.max(0.6, def?.radius ?? 2);
  }, [abilityId]);

  const coneProgA = useMemo(() => ({ current: 0.42 }), []);
  const coneProgB = useMemo(() => ({ current: 0.72 }), []);

  if (!show) return null;

  return (
    <>
      <group ref={feet} visible={false}>
        <group ref={rangeRing} position={[0, Y, 0]} visible={false}>
          <mesh ref={rangeRingOk} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <ringGeometry args={[0.985, 1, 72]} />
            <meshBasicMaterial
              color={RANGE_RING_OK}
              transparent
              opacity={0.32}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh ref={rangeRingOor} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <ringGeometry args={[0.996, 1.002, 96]} />
            <meshBasicMaterial
              color={RANGE_RING_OOR}
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>

        {(kind === "cone" || kind === "meleeArc") && (
          <>
            <AoeRimMarker
              radius={coneLen}
              shape="cone"
              halfAngle={coneHalf}
              color={CAST_AIM_COLOR}
              hotColor={CAST_AIM_HOT}
              fill={0.14}
              rimWidth={RIM.rimWidth}
              glowWidth={RIM.glowWidth}
              noise={RIM.noise}
              opacity={RIM.opacity}
              opacityMulRef={opacityRef}
              pulse={false}
              y={Y}
            />
            {/* Concentric range guides inside the cone */}
            <AoeRimMarker
              radius={coneLen}
              shape="cone"
              halfAngle={coneHalf}
              color={CAST_AIM_COLOR}
              hotColor={CAST_AIM_HOT}
              fill={0.02}
              rimWidth={0.007}
              glowWidth={0.018}
              noise={0.03}
              opacity={0.28}
              opacityMulRef={opacityRef}
              progressRef={coneProgA}
              pulse={false}
              y={Y + 0.002}
            />
            <AoeRimMarker
              radius={coneLen}
              shape="cone"
              halfAngle={coneHalf}
              color={CAST_AIM_COLOR}
              hotColor={CAST_AIM_HOT}
              fill={0.02}
              rimWidth={0.007}
              glowWidth={0.018}
              noise={0.03}
              opacity={0.28}
              opacityMulRef={opacityRef}
              progressRef={coneProgB}
              pulse={false}
              y={Y + 0.004}
            />
          </>
        )}

        {kind === "selfCircle" && (
          <group>
            <AoeRimMarker
              radius={selfR}
              shape="circle"
              color={CAST_AIM_COLOR}
              hotColor={CAST_AIM_HOT}
              fill={RIM.fill}
              rimWidth={RIM.rimWidth}
              glowWidth={RIM.glowWidth}
              noise={RIM.noise}
              opacity={RIM.opacity}
              opacityMulRef={opacityRef}
              pulse={false}
              y={Y}
            />
            {/* Arc Blade — brighter outer band (~40%) to hint the sweet spot. */}
            {abilityId === "arcBlade" && (
              <AoeRimMarker
                radius={selfR}
                shape="circle"
                color="#38BDF8"
                hotColor="#A5F3FC"
                fill={0.08}
                rimWidth={RIM.rimWidth * 1.2}
                glowWidth={RIM.glowWidth * 1.15}
                noise={RIM.noise}
                opacity={0.5}
                opacityMulRef={opacityRef}
                pulse={false}
                y={Y + 0.003}
              />
            )}
            <group scale={[selfR, 1, selfR]}>
              <CastAimReticle color={CAST_AIM_COLOR} y={Y + 0.002} />
            </group>
          </group>
        )}
      </group>

      <group ref={aimGroup} visible={false}>
        {(kind === "placeCircle" ||
          kind === "forwardPlace" ||
          kind === "magmaOrbs" ||
          kind === "allyBind") && (
          <>
            <AoeRimMarker
              radius={1}
              shape="circle"
              color={CAST_AIM_COLOR}
              hotColor={CAST_AIM_HOT}
              fill={0.14}
              rimWidth={RIM.rimWidth}
              glowWidth={RIM.glowWidth}
              noise={RIM.noise}
              opacity={0.42}
              opacityMulRef={opacityRef}
              pulse={false}
              y={Y}
            />
            <CastAimReticle color={CAST_AIM_COLOR} y={Y + 0.002} />
          </>
        )}
        {kind === "blink" &&
          (ABILITIES[abilityId!]?.id === "smash" || (ABILITIES[abilityId!]?.radius ?? 0) > 1.4 ? (
            <>
              <AoeRimMarker
                radius={Math.max(0.8, ABILITIES[abilityId!]?.radius ?? 1.5)}
                shape="circle"
                color={CAST_AIM_COLOR}
                hotColor={CAST_AIM_HOT}
                fill={RIM.fill}
                rimWidth={RIM.rimWidth}
                glowWidth={RIM.glowWidth}
                noise={RIM.noise}
                opacity={RIM.opacity}
                opacityMulRef={opacityRef}
                pulse={false}
                y={Y}
              />
              <group
                scale={[
                  1 / Math.max(0.8, ABILITIES[abilityId!]?.radius ?? 1.5),
                  1,
                  1 / Math.max(0.8, ABILITIES[abilityId!]?.radius ?? 1.5),
                ]}
              >
                <CastAimReticle color={CAST_AIM_COLOR} />
              </group>
            </>
          ) : (
            <GroundMagicCircle color={CAST_AIM_COLOR} radius={0.95} spin={1.2} showRune y={0} />
          ))}
      </group>

      <group ref={midGroup} visible={false}>
        {(kind === "wall" || kind === "line") && (
          <AoeRimMarker
            radius={wallHalfW}
            length={wallLen}
            shape="capsule"
            color={CAST_AIM_COLOR}
            hotColor={CAST_AIM_HOT}
            fill={0.12}
            rimWidth={RIM.rimWidth}
            glowWidth={RIM.glowWidth}
            noise={RIM.noise}
            opacity={RIM.opacity}
            opacityMulRef={opacityRef}
            pulse={false}
            y={Y}
          />
        )}
      </group>

      <mesh ref={lineMesh} visible={false} renderOrder={2}>
        <boxGeometry args={[1, 0.03, 1]} />
        <meshBasicMaterial
          color={CAST_AIM_COLOR}
          transparent
          opacity={0.38}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <line
        ref={curveLeft}
        geometry={curveGeos.left}
        material={curveMat}
        visible={false}
        frustumCulled={false}
        renderOrder={3}
      />
      <line
        ref={curveRight}
        geometry={curveGeos.right}
        material={curveMat}
        visible={false}
        frustumCulled={false}
        renderOrder={3}
      />
    </>
  );
}
