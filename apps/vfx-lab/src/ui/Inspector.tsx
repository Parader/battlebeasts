import { ABILITIES, phaseDurationMs } from "@battlebeasts/shared";
import {
  getAbilityVfxProfile,
  hasCatalogImpactFx,
  hasCatalogProjectile,
  isOwnedByCastProjectile,
} from "@web/game/vfx";
import {
  SPIKE_MS,
  getPerfLatest,
  subscribePerfData,
} from "@web/game/perfHudRuntime";
import { useEffect, useState } from "react";
import { labStop } from "../sim/labDirector";
import {
  SANDBOX_CASTER_COUNTS,
  SANDBOX_DUMMY_COUNTS,
  labSim,
} from "../sim/labSim";
import { labStore, useLabStore, type TimingOverrides } from "../state/labStore";

function applyRoster(patch: { dummyCount?: number; casterCount?: number }): void {
  labStop();
  const next = {
    dummyCount: patch.dummyCount ?? labStore.get().dummyCount,
    casterCount: patch.casterCount ?? labStore.get().casterCount,
  };
  labSim.syncRoster(next.dummyCount, next.casterCount);
  labStore.set(next);
}

function PerfPanel() {
  const shotCount = useLabStore((s) => s.shotCount);
  const shotWarn = useLabStore((s) => s.shotWarn);
  const dummyCount = useLabStore((s) => s.dummyCount);
  const casterCount = useLabStore((s) => s.casterCount);
  const [, bump] = useState(0);

  useEffect(() => subscribePerfData(() => bump((n) => n + 1)), []);

  const s = getPerfLatest();
  const fpsWarn = s.fps > 0 && s.fps < 50;
  const hitchWarn = s.spikes > 0 || s.p95Ms > SPIKE_MS || s.worstMs > SPIKE_MS;
  const compileWarn = s.newPrograms > 0;
  const drawWarn = s.calls > 400;

  useEffect(() => {
    const el = document.getElementById("lab-perf-status");
    if (!el) return;
    const fps = s.fps > 0 ? s.fps.toFixed(0) : "—";
    const warn = fpsWarn || hitchWarn;
    el.textContent = `${fps} fps · ${s.avgMs.toFixed(1)} ms · ${s.calls} draws · ${shotCount} shots`;
    el.classList.toggle("warn", warn);
  }, [s, shotCount, fpsWarn, hitchWarn]);

  return (
    <div className="section">
      <h3>Performance</h3>
      {fpsWarn ? <div className="banner error">Frame rate dropped below 50 fps</div> : null}
      {hitchWarn && !fpsWarn ? (
        <div className="banner warn">Hitch / p95 frame over 33 ms</div>
      ) : null}
      {compileWarn ? <div className="banner warn">Shader compiled while playing</div> : null}
      {shotWarn ? <div className="banner error">Shot count climbing across loops</div> : null}
      <div className={`diag ${fpsWarn ? "warn" : ""}`}>
        <span>fps</span>
        <span>{s.fps > 0 ? s.fps.toFixed(0) : "—"}</span>
      </div>
      <div className="diag">
        <span>frame avg</span>
        <span>{s.avgMs.toFixed(1)} ms</span>
      </div>
      <div className={`diag ${s.p95Ms > SPIKE_MS ? "warn" : ""}`}>
        <span>frame p95</span>
        <span>{s.p95Ms.toFixed(1)} ms</span>
      </div>
      <div className={`diag ${s.worstMs > SPIKE_MS ? "warn" : ""}`}>
        <span>worst</span>
        <span>{s.worstMs.toFixed(1)} ms</span>
      </div>
      <div className={`diag ${s.spikes > 0 ? "warn" : ""}`}>
        <span>hitches / 3s</span>
        <span>{s.spikes}</span>
      </div>
      <div className={`diag ${drawWarn ? "warn" : ""}`}>
        <span>draw calls</span>
        <span>{s.calls}</span>
      </div>
      <div className={`diag ${shotWarn ? "warn" : ""}`}>
        <span>one-shots</span>
        <span>{shotCount}</span>
      </div>
      <div className="diag">
        <span>bodies</span>
        <span>
          {casterCount} casters · {dummyCount} dummies
        </span>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        F9 — full draw profiler
      </div>
    </div>
  );
}

function TargetPlacement({
  abilityRange,
  abilityRadius,
}: {
  abilityRange: number;
  abilityRadius: number;
}) {
  const epoch = useLabStore((s) => s.targetEpoch);
  const dummy = labSim.target();
  const [x, setX] = useState(dummy.x);
  const [z, setZ] = useState(dummy.z);

  useEffect(() => {
    const t = labSim.target();
    setX(t.x);
    setZ(t.z);
  }, [epoch]);

  const reach = abilityRange > 0 ? abilityRange : abilityRadius > 0 ? abilityRadius : 8;

  const place = (dist: number) => {
    labSim.placeTargetAtRange(dist);
    const t = labSim.target();
    setX(t.x);
    setZ(t.z);
    labStore.set({ targetEpoch: labStore.get().targetEpoch + 1 });
  };

  const applyXz = (nx: number, nz: number) => {
    if (!Number.isFinite(nx) || !Number.isFinite(nz)) return;
    labSim.setTargetPos(nx, nz);
    const t = labSim.target();
    setX(t.x);
    setZ(t.z);
    labStore.set({ targetEpoch: labStore.get().targetEpoch + 1 });
  };

  return (
    <>
      <div className="diag" style={{ marginTop: 8 }}>
        <span>distance</span>
        <span id="lab-range">8.0 m</span>
      </div>
      <div className="diag">
        <span>ability</span>
        <span className="muted">{reach.toFixed(1)} m</span>
      </div>
      <div className="row">
        <label>X</label>
        <input
          type="number"
          step={0.5}
          value={Number.isInteger(x) ? x : Number(x.toFixed(1))}
          onChange={(e) => applyXz(Number(e.target.value), z)}
        />
      </div>
      <div className="row">
        <label>Z</label>
        <input
          type="number"
          step={0.5}
          value={Number.isInteger(z) ? z : Number(z.toFixed(1))}
          onChange={(e) => applyXz(x, Number(e.target.value))}
        />
      </div>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <button onClick={() => place(2)}>Close</button>
        <button onClick={() => place(8)}>8 m</button>
        <button onClick={() => place(reach)}>Range</button>
        <button onClick={() => place(reach + 4)}>OOR</button>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        Drag the red dummy · WASD caster · Shift+WASD dummy
      </div>
    </>
  );
}

function TimingRow({
  label,
  field,
  live,
}: {
  label: string;
  field: keyof TimingOverrides;
  live: number;
}) {
  const timing = useLabStore((s) => s.timing);
  const value = timing[field] ?? live;
  return (
    <div className="row">
      <label>{label}</label>
      <input
        type="number"
        min={0}
        step={10}
        value={Math.round(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          labStore.set({
            timing: {
              ...labStore.get().timing,
              [field]: Number.isFinite(n) ? n : live,
            },
          });
        }}
      />
      <span className="muted" title="AbilityDef wall-clock">
        {Math.round(live)}
      </span>
    </div>
  );
}

export function Inspector() {
  const abilityId = useLabStore((s) => s.abilityId);
  const targetMode = useLabStore((s) => s.targetMode);
  const relation = useLabStore((s) => s.relation);
  const dummyCount = useLabStore((s) => s.dummyCount);
  const casterCount = useLabStore((s) => s.casterCount);
  const def = ABILITIES[abilityId];
  const profile = getAbilityVfxProfile(abilityId);
  if (!def) return <div className="right" />;

  const legacyRing = profile.combatFx?.skipLegacyBurst !== true;
  const fallbackSphere =
    def.shape === "projectile" &&
    profile.projectile !== "ownedByCast" &&
    profile.projectile !== "none" &&
    !hasCatalogProjectile(abilityId) &&
    !isOwnedByCastProjectile(abilityId);
  const boltImpactReuse = abilityId === "poisonDart";

  return (
    <div className="right">
      <div className="section">
        <h3>{def.name}</h3>
        <div className="muted">{def.id}</div>
      </div>
      <div className="section">
        <h3>Target</h3>
        <div className="toolbar">
          {(["dummy", "ground", "self"] as const).map((m) => (
            <button
              key={m}
              className={targetMode === m ? "active" : ""}
              onClick={() => labStore.set({ targetMode: m })}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="toolbar" style={{ marginTop: 6 }}>
          {(["enemy", "ally", "self"] as const).map((m) => (
            <button
              key={m}
              className={relation === m ? "active" : ""}
              onClick={() => labStore.set({ relation: m })}
            >
              {m}
            </button>
          ))}
        </div>
        <TargetPlacement
          abilityRange={typeof def.range === "number" ? def.range : 0}
          abilityRadius={typeof def.radius === "number" ? def.radius : 0}
        />
      </div>
      <div className="section">
        <h3>Sandbox</h3>
        <div className="muted" style={{ marginBottom: 6 }}>
          WASD walks the caster (cast slow applies). Shift+WASD walks the dummy.
          Mouse aims dashes, blinks, and ground spells. Extra dummies stay in the
          AoE. Crowd casters fire the same spell together.
        </div>
        <div className="row">
          <label>Dummies</label>
          <div className="toolbar">
            {SANDBOX_DUMMY_COUNTS.map((n) => (
              <button
                key={n}
                className={dummyCount === n ? "active" : ""}
                onClick={() => applyRoster({ dummyCount: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <label>Casters</label>
          <div className="toolbar">
            {SANDBOX_CASTER_COUNTS.map((n) => (
              <button
                key={n}
                className={casterCount === n ? "active" : ""}
                onClick={() => applyRoster({ casterCount: n })}
              >
                {n === 10 ? "10 crowd" : n}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="section">
        <h3>Timing (wall ms)</h3>
        <TimingRow label="Antic." field="anticipationMs" live={phaseDurationMs(def, "anticipation")} />
        <TimingRow label="Cast" field="castMs" live={phaseDurationMs(def, "cast")} />
        <TimingRow label="Impact" field="impactMs" live={phaseDurationMs(def, "impact")} />
        <TimingRow label="Recover" field="recoveryMs" live={phaseDurationMs(def, "recovery")} />
        <TimingRow
          label="Lead"
          field="leadMs"
          live={profile.muzzleLead?.leadMs ?? 0}
        />
        <button
          onClick={() => labStore.set({ timing: {} })}
          style={{ marginTop: 6 }}
        >
          Reset overrides
        </button>
      </div>
      <div className="section">
        <h3>Profile</h3>
        <div className="diag">
          <span>engine</span>
          <span>{profile.castEngine}</span>
        </div>
        <div className="diag">
          <span>projectile</span>
          <span>{profile.projectile ?? "—"}</span>
        </div>
        <div className="diag">
          <span>onHit</span>
          <span>{profile.combatFx?.onHit ?? "—"}</span>
        </div>
        <div className="diag">
          <span>onAoe</span>
          <span>{profile.combatFx?.onAoe ?? "—"}</span>
        </div>
        <div className="diag">
          <span>catalog impact</span>
          <span>{hasCatalogImpactFx(abilityId) ? "yes" : "no"}</span>
        </div>
      </div>
      <div className="section">
        <h3>Cheap tells</h3>
        {legacyRing ? <div className="banner warn">Legacy expanding ring</div> : null}
        {fallbackSphere ? <div className="banner warn">Fallback projectile sphere</div> : null}
        {boltImpactReuse ? <div className="banner warn">poisonDart impact reuses BoltImpact</div> : null}
        {!legacyRing && !fallbackSphere && !boltImpactReuse ? (
          <div className="muted">No known fallback path</div>
        ) : null}
      </div>
      <PerfPanel />
    </div>
  );
}
