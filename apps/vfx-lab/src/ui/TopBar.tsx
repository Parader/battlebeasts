import { ABILITIES, phaseDurationMs } from "@battlebeasts/shared";
import {
  labPause,
  labPlay,
  labReplay,
  labStop,
} from "../sim/labDirector";
import { labStore, useLabStore } from "../state/labStore";
import { Timeline } from "./Timeline";

export function TopBar() {
  const playing = useLabStore((s) => s.playing);
  const paused = useLabStore((s) => s.paused);
  const looping = useLabStore((s) => s.looping);
  const allowOverlap = useLabStore((s) => s.allowOverlap);
  const lighting = useLabStore((s) => s.lighting);
  const camera = useLabStore((s) => s.camera);
  const abilityId = useLabStore((s) => s.abilityId);
  const def = ABILITIES[abilityId];
  const total = def
    ? phaseDurationMs(def, "anticipation") +
      phaseDurationMs(def, "cast") +
      phaseDurationMs(def, "impact") +
      phaseDurationMs(def, "recovery")
    : 0;

  return (
    <div className="topbar">
      <span className="title">Spell VFX Lab</span>
      <button className="active" onClick={() => (playing && !paused ? labPause() : labPlay())}>
        {playing && !paused ? "Pause" : "Play"}
      </button>
      <button onClick={labReplay}>Replay</button>
      <button onClick={labStop}>Stop</button>
      <button
        className={looping ? "active" : ""}
        onClick={() => labStore.set({ looping: !looping })}
      >
        Loop
      </button>
      <button
        className={allowOverlap ? "active" : ""}
        onClick={() => labStore.set({ allowOverlap: !allowOverlap })}
        title="Leave previous VFX alive (stacked-fight test)"
      >
        Overlap
      </button>
      <div className="spacer" />
      <button
        className={camera === "follow" ? "active" : ""}
        onClick={() => labStore.set({ camera: "follow" })}
      >
        Player view
      </button>
      <button
        className={camera === "orbit" ? "active" : ""}
        onClick={() => labStore.set({ camera: "orbit", gameViewNonce: Date.now() })}
      >
        Inspect
      </button>
      <button
        className={lighting === "outdoor" ? "active" : ""}
        onClick={() => labStore.set({ lighting: "outdoor" })}
      >
        Outdoor
      </button>
      <button
        className={lighting === "dungeon" ? "active" : ""}
        onClick={() => labStore.set({ lighting: "dungeon" })}
      >
        Dungeon
      </button>
      <span className="muted">{Math.round(total)} ms</span>
      <Timeline />
    </div>
  );
}
