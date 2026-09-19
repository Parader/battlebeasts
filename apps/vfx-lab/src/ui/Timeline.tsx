import { ABILITIES, phaseDurationMs } from "@battlebeasts/shared";
import { useEffect, useRef } from "react";
import { setPlayheadEl, totalWallMs } from "../sim/labDirector";
import { PHASES, useLabStore, type LabUiState } from "../state/labStore";

function phaseWall(
  def: NonNullable<(typeof ABILITIES)[string]>,
  id: (typeof PHASES)[number],
  timing: LabUiState["timing"],
): number {
  if (id === "anticipation") return timing.anticipationMs ?? phaseDurationMs(def, id);
  if (id === "cast") return timing.castMs ?? phaseDurationMs(def, id);
  if (id === "impact") return timing.impactMs ?? phaseDurationMs(def, id);
  return timing.recoveryMs ?? phaseDurationMs(def, id);
}

export function Timeline() {
  const abilityId = useLabStore((s) => s.abilityId);
  const timing = useLabStore((s) => s.timing);
  const needle = useRef<HTMLDivElement>(null);
  const def = ABILITIES[abilityId];

  useEffect(() => {
    setPlayheadEl(needle.current);
    return () => setPlayheadEl(null);
  }, []);

  if (!def) return null;
  const total = totalWallMs(def, timing);

  return (
    <div className="timeline" title="Cast phases (wall-clock)">
      <div className="timeline__track">
        {PHASES.map((id) => {
          const ms = phaseWall(def, id, timing);
          const pct = (ms / total) * 100;
          if (pct <= 0) return null;
          return (
            <div key={id} className={`timeline__seg timeline__seg--${id}`} style={{ width: `${pct}%` }}>
              {pct > 12 ? id : ""}
            </div>
          );
        })}
        <div className="timeline__playhead" ref={needle} />
      </div>
    </div>
  );
}
