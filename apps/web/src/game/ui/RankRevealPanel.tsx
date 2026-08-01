import { useEffect, useState, type CSSProperties } from "react";
import {
  divisionRoman,
  type RankDivision,
  type RankTier,
} from "@battlebeasts/shared";

export type RankRevealState = {
  kind: "promote" | "demote" | "placement";
  tierBefore: string;
  tierAfter: string;
  divisionBefore: number;
  divisionAfter: number;
  lpAfter: number;
  label: string;
};

type Props = {
  reveal: RankRevealState;
  onClose: () => void;
};

const TIER_HEX: Record<string, string> = {
  bronze: "#b87333",
  silver: "#c0c7d1",
  gold: "#e0b13a",
  diamond: "#5ec8e8",
  champion: "#c084fc",
  master: "#f472b6",
  grandmaster: "#fbbf24",
};

const SHAKE_MS = 900;
const REVEAL_MS = 700;
const LABEL_DELAY_MS = 120;

function easeInOut(t: number) {
  return t * t * (3 - 2 * t);
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortLabel(tier: string, division: number): string {
  if (tier === "master" || tier === "grandmaster") return capitalize(tier);
  const d = Math.max(1, Math.min(3, division || 3)) as RankDivision;
  return `${capitalize(tier)} ${divisionRoman(d)}`;
}

/** Full-screen rank badge reveal — shake → bloom → badge slam (mirrors chest cadence). */
export function RankRevealPanel({ reveal, onClose }: Props) {
  const [shake, setShake] = useState(0);
  const [bloom, setBloom] = useState(0);
  const [slam, setSlam] = useState(0);
  const [showLabel, setShowLabel] = useState(false);

  const hex = TIER_HEX[reveal.tierAfter] ?? TIER_HEX.bronze;
  const headline =
    reveal.kind === "placement"
      ? "Placement complete"
      : reveal.kind === "promote"
        ? "Promotion"
        : "Demotion";

  useEffect(() => {
    setShake(0);
    setBloom(0);
    setSlam(0);
    setShowLabel(false);
    const start = performance.now();
    let raf = 0;
    let labeled = false;

    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed < SHAKE_MS) {
        const t = elapsed / SHAKE_MS;
        setShake(easeInOut(Math.min(1, t / 0.5)) * (0.3 + 0.7 * easeInOut(t)));
        setBloom(t > 0.78 ? easeInOut((t - 0.78) / 0.22) * 0.2 : 0);
        setSlam(0);
      } else {
        setShake(Math.max(0, 1 - (elapsed - SHAKE_MS) / 160));
        const ot = Math.min(1, (elapsed - SHAKE_MS) / REVEAL_MS);
        setSlam(easeOutBack(ot));
        setBloom(Math.min(1, 0.2 + easeInOut(Math.min(1, ot / 0.5)) * 0.8));
      }

      if (!labeled && elapsed >= SHAKE_MS + REVEAL_MS + LABEL_DELAY_MS) {
        labeled = true;
        setShowLabel(true);
      }

      if (elapsed < SHAKE_MS + REVEAL_MS + LABEL_DELAY_MS + 350) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reveal]);

  const shakeX = Math.sin(shake * 42) * shake * 10;
  const shakeY = Math.cos(shake * 37) * shake * 7;
  const scale = 0.55 + slam * 0.55;

  return (
    <div
      data-ui-overlay
      className="bb-rank-reveal pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center"
    >
      <div
        className="bb-rank-reveal__glow pointer-events-none absolute inset-0"
        style={{
          opacity: bloom,
          background: `radial-gradient(ellipse at center, ${hex}55 0%, transparent 55%)`,
        }}
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-5 px-4">
        <p
          className={[
            "bb-rank-reveal__headline transition-opacity duration-500",
            showLabel ? "opacity-100" : "opacity-0",
          ].join(" ")}
        >
          {headline}
        </p>

        <div
          className="bb-rank-badge"
          style={
            {
              ["--bb-rank-hex" as string]: hex,
              transform: `translate(${shakeX}px, ${shakeY}px) scale(${scale}) rotate(${(1 - slam) * -8}deg)`,
              opacity: 0.35 + slam * 0.65,
            } as CSSProperties
          }
        >
          <div className="bb-rank-badge__ring" />
          <div className="bb-rank-badge__face">
            <span className="bb-rank-badge__tier">{capitalize(reveal.tierAfter as RankTier)}</span>
            {reveal.tierAfter !== "master" && reveal.tierAfter !== "grandmaster" ? (
              <span className="bb-rank-badge__div">
                {divisionRoman(Math.max(1, Math.min(3, reveal.divisionAfter || 3)) as RankDivision)}
              </span>
            ) : null}
          </div>
        </div>

        <div
          className={[
            "flex flex-col items-center gap-1 transition-opacity duration-500",
            showLabel ? "opacity-100" : "opacity-0",
          ].join(" ")}
        >
          <p className="bb-rank-reveal__fromto">
            {shortLabel(reveal.tierBefore, reveal.divisionBefore)}
            <span aria-hidden> → </span>
            {shortLabel(reveal.tierAfter, reveal.divisionAfter)}
          </p>
          <p className="bb-rank-reveal__sub">{reveal.label}</p>
        </div>

        <button
          type="button"
          className="bb-chest-reveal__collect mt-2"
          disabled={!showLabel}
          onClick={onClose}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
