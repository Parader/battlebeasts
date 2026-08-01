import { useEffect, useState } from "react";
import { chargeHudRuntime } from "../chargeHudRuntime";

/**
 * Center-bottom charge meter for tap-charge spells (Fireball).
 * Fills 0→1 over chargeMax, then holds/pulses during the auto-cast grace.
 */
export function ChargeChannelHud() {
  const [tick, setTick] = useState(0);
  const [active, setActive] = useState(() => chargeHudRuntime.getState().active);

  useEffect(() => {
    return chargeHudRuntime.subscribe(() => {
      setActive(chargeHudRuntime.getState().active);
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

  const st = chargeHudRuntime.getState();
  void tick;
  const elapsed = Math.max(0, performance.now() - st.startedAt);
  const fill = Math.min(1, elapsed / Math.max(1, st.maxMs));
  const atMax = fill >= 0.999;
  const holdT =
    atMax && st.holdMs > 0
      ? Math.min(1, (elapsed - st.maxMs) / Math.max(1, st.holdMs))
      : 0;

  return (
    <div
      data-ui-overlay
      className="bb-charge-channel pointer-events-none absolute bottom-28 left-1/2 z-25 -translate-x-1/2"
      role="status"
      aria-label="Spell charge"
    >
      <div className="bb-charge-channel__label">
        {atMax ? "Release!" : "Charging"}
      </div>
      <div className="bb-charge-channel__track">
        <div
          className={[
            "bb-charge-channel__fill",
            atMax ? "bb-charge-channel__fill--max" : "",
          ].join(" ")}
          style={{ width: `${fill * 100}%` }}
        />
        {atMax && (
          <div
            className="bb-charge-channel__hold"
            style={{ width: `${holdT * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}
