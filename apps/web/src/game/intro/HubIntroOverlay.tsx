import { useEffect, useState } from "react";
import {
  getHubIntroSnapshot,
  skipHubIntro,
  subscribeHubIntro,
  type HubIntroSnapshot,
} from "./hubIntroRuntime";

/** Full-screen fade + captions + Skip during hub intro. */
export function HubIntroOverlay() {
  const [snap, setSnap] = useState<HubIntroSnapshot>(getHubIntroSnapshot);

  useEffect(() => subscribeHubIntro(() => setSnap(getHubIntroSnapshot())), []);

  const active = snap.phase === "playing" || snap.phase === "handingOff";
  if (!active && snap.fade < 0.01 && !snap.objectiveVisible) return null;

  return (
    <>
      {snap.fade > 0.01 ? (
        <div
          className="pointer-events-none absolute inset-0 z-[45]"
          style={{
            background: `rgba(0,0,0,${snap.fade.toFixed(3)})`,
            transition: "none",
          }}
          aria-hidden
        />
      ) : null}

      {active ? (
        <div
          data-ui-overlay
          className="pointer-events-none absolute inset-0 z-[46] flex flex-col items-center justify-end pb-[18vh]"
        >
          {snap.caption ? (
            <p
              className="max-w-xl whitespace-pre-line px-6 text-center text-[1.35rem] leading-snug text-[#e8f2fa] drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)] sm:text-[1.55rem]"
              style={{ fontFamily: "var(--bb-font-display)" }}
            >
              {snap.caption}
            </p>
          ) : null}
          <button
            type="button"
            className="pointer-events-auto bb-btn-ink mt-8 opacity-90"
            onClick={() => skipHubIntro()}
            style={{ visibility: snap.phase === "playing" && snap.fade < 0.2 ? "visible" : "hidden" }}
          >
            Skip
          </button>
        </div>
      ) : null}

      {snap.objectiveVisible && snap.phase === "done" ? (
        <div
          data-ui-overlay
          className="pointer-events-none absolute inset-x-0 top-24 z-30 flex justify-center"
        >
          <div className="bb-parchment px-5 py-2.5 text-center">
            <p className="bb-section-label mb-0.5">Objective</p>
            <p
              className="text-base text-[var(--bb-ink)]"
              style={{ fontFamily: "var(--bb-font-display)" }}
            >
              {snap.objectiveText}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
