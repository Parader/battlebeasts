import type { OneShotEffect } from "../types";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";

/** Ally rejuvenation burst (1) or enemy poison burst (2). */
export function ShroomBurstEffect({ shot }: { shot: OneShotEffect }) {
  const ally = (shot.variant ?? 1) === 1;
  const base = ally ? groundPresets.iceFrost : groundPresets.iceFrost;
  const coreColor = ally ? "#86efac" : "#a3e635";
  const mistColor = ally ? "#4ade80" : "#65a30d";
  const preset = {
    ...base,
    element: (ally ? "poison" : "poison") as const,
    shape: "circle" as const,
    colorCore: ally ? "#dcfce7" : "#ecfccb",
    colorMid: ally ? "#4ade80" : "#a3e635",
    colorEdge: ally ? "#166534" : "#3f6212",
    opacity: 0.88,
    additive: true,
    radius: shot.radius ?? 3.4,
    lifeMs: 900,
    ringWidth: 0.12,
    softness: 0.07,
    innerRatio: 0.18,
    spin: ally ? 0.35 : 0.55,
  };
  const radius = shot.radius ?? 3.4;
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
      {/* Spore cloud — fast outward pop. */}
      <AdditiveParticleBurst
        color={coreColor}
        origin={[0, 0.35, 0]}
        count={28}
        life={0.55}
        speed={3.4}
        speedSpread={2.2}
        size={0.2}
        sizeEnd={0.03}
        lift={1.6}
        upBias={0.45}
        fadeIn={0.12}
        stagger={0.18}
        trigger={shot.key}
      />
      {/* Soft mist hang. */}
      <AdditiveParticleBurst
        color={mistColor}
        origin={[0, 0.2, 0]}
        count={18}
        life={0.75}
        speed={1.6}
        speedSpread={1.1}
        size={0.28}
        sizeEnd={0.05}
        lift={0.9}
        upBias={0.55}
        fadeIn={0.22}
        stagger={0.35}
        trigger={shot.key}
      />
    </group>
  );
}
