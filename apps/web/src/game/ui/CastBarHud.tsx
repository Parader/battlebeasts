import { useEffect, useState } from "react";
import { ABILITIES } from "@battlebeasts/shared";
import { castBarRuntime } from "../castBarRuntime";
import { SpellIcon } from "./SpellIcon";

/**
 * Classic WoW-style cast bar — center-bottom, above the ability bar.
 * Shows for windups / channels / charges above CAST_BAR_MIN_MS.
 */
export function CastBarHud() {
  const [tick, setTick] = useState(0);
  const [active, setActive] = useState(() => castBarRuntime.getState().active);

  useEffect(() => {
    return castBarRuntime.subscribe(() => {
      setActive(castBarRuntime.getState().active);
      setTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setTick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;

  const st = castBarRuntime.getState();
  void tick;
  const elapsed = Math.max(0, performance.now() - st.startedAt);
  const raw = Math.min(1, elapsed / Math.max(1, st.durationMs));
  // Channels deplete (WoW); casts / charges fill.
  const fill = st.mode === "channel" ? 1 - raw : raw;
  const atMax = st.mode !== "channel" && raw >= 0.999;
  const holdT =
    atMax && st.holdMs > 0
      ? Math.min(1, (elapsed - st.durationMs) / Math.max(1, st.holdMs))
      : 0;

  const def = ABILITIES[st.abilityId];
  const label =
    st.mode === "charge" && atMax
      ? "Release!"
      : st.mode === "charge"
        ? "Charging"
        : st.mode === "channel"
          ? "Channeling"
          : st.name || def?.name || "Casting";

  return (
    <div
      data-ui-overlay
      className={[
        "bb-cast-bar pointer-events-none absolute bottom-[17.75rem] left-1/2 z-25 -translate-x-1/2",
        `bb-cast-bar--${st.mode}`,
        st.interruptible ? "bb-cast-bar--interruptible" : "",
        atMax ? "bb-cast-bar--max" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-label={`${label} ${Math.round(fill * 100)}%`}
    >
      <div className="bb-cast-bar__row">
        <SpellIcon abilityId={st.abilityId} size={28} className="bb-cast-bar__icon" />
        <div className="bb-cast-bar__body">
          <div className="bb-cast-bar__label">{label}</div>
          <div className="bb-cast-bar__track">
            <div
              className={[
                "bb-cast-bar__fill",
                atMax ? "bb-cast-bar__fill--max" : "",
              ].join(" ")}
              style={{ width: `${Math.max(0, fill) * 100}%` }}
            />
            {atMax && holdT > 0 && (
              <div className="bb-cast-bar__hold" style={{ width: `${holdT * 100}%` }} />
            )}
            {st.interruptible && st.mode === "cast" && (
              <div className="bb-cast-bar__spark" aria-hidden />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
