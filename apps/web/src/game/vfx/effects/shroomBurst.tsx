import type { OneShotEffect } from "../types";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";

/** Ally rejuvenation burst (1) or enemy poison burst (2). */
export function ShroomBurstEffect({ shot }: { shot: OneShotEffect }) {
  const ally = (shot.variant ?? 1) === 1;
  // Cap — a bad/missing radius must never scale into a camera-filling plane.
  const radius = Math.min(4.2, Math.max(0.8, shot.radius ?? (ally ? 0.9 : 3.4)));

  // Same poison shader path for both. Enemy used `fire` + additive before, which
  // with arena bloom could flash the whole frame black on trigger only.
  const preset = {
    ...groundPresets.poisonBlot,
    element: "poison" as const,
    shape: "circle" as const,
    colorCore: ally ? "#dcfce7" : "#fecaca",
    colorMid: ally ? "#4ade80" : "#f87171",
    colorEdge: ally ? "#166534" : "#991b1b",
    opacity: ally ? 0.82 : 0.78,
    // Normal blend — additive + bloom was the suspect for enemy-only black frames.
    additive: false,
    radius,
    lifeMs: 900,
    ringWidth: 0.12,
    softness: 0.08,
    innerRatio: 0.2,
    breakup: 0.5,
    spin: ally ? 0.3 : 0.4,
    appearEnd: 0.06,
    fadeStart: 0.72,
  };

  const coreColor = ally ? "#86efac" : "#fca5a5";
  const mistColor = ally ? "#4ade80" : "#ef4444";

  return (
    <group position={[shot.x, 0, shot.z]}>
      <GroundDecal
        preset={preset}
        shape="circle"
        x={0}
        z={0}
        y={0.04}
        born={shot.born}
        life={Math.max(shot.life, 900)}
        radius={radius}
      />
      <AdditiveParticleBurst
        color={coreColor}
        origin={[0, 0.35, 0]}
        count={ally ? 28 : 22}
        life={0.55}
        speed={ally ? 3.4 : 2.8}
        speedSpread={ally ? 2.2 : 1.6}
        size={0.18}
        sizeEnd={0.03}
        lift={1.4}
        upBias={0.45}
        fadeIn={0.12}
        stagger={0.18}
        trigger={shot.key}
      />
      <AdditiveParticleBurst
        color={mistColor}
        origin={[0, 0.2, 0]}
        count={ally ? 18 : 14}
        life={0.7}
        speed={1.5}
        speedSpread={1.0}
        size={0.24}
        sizeEnd={0.05}
        lift={0.85}
        upBias={0.55}
        fadeIn={0.22}
        stagger={0.3}
        trigger={shot.key}
      />
    </group>
  );
}
