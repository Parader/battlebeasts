import { useMemo, useState } from "react";
import {
  PVE_PORTAL_CONTENTS,
  PVP_PORTAL_MODES,
  pvpModeCapacity,
  pvpModeFitsPlayerCount,
} from "@battlebeasts/shared";
import { GamePanelShell } from "./GamePanelShell";

type Props = {
  kind: "portal_pvp" | "portal_pve";
  onClose: () => void;
  hubPlayerCount?: number;
  onConfirm: (
    portal: "pvp" | "pve",
    params: { modes?: string[]; content?: string; modifiers?: string[] },
  ) => void;
};

export function PortalPanel({ kind, onClose, onConfirm, hubPlayerCount = 1 }: Props) {
  const enabledModes = useMemo(
    () => PVP_PORTAL_MODES.filter((m) => pvpModeFitsPlayerCount(m.id, hubPlayerCount)),
    [hubPlayerCount],
  );
  const [modes, setModes] = useState<string[]>(() =>
    enabledModes[0] ? [enabledModes[0].id] : ["arena_1v1"],
  );
  const [pveContent, setPveContent] = useState(
    () => PVE_PORTAL_CONTENTS[0]?.id ?? "dungeon",
  );

  const isPvp = kind === "portal_pvp";
  const title = isPvp ? "PvP Portal" : "PvE / Coop Portal";
  const canEnterPvp = isPvp && modes.some((id) => pvpModeFitsPlayerCount(id, hubPlayerCount));
  const canEnterPve = !isPvp && PVE_PORTAL_CONTENTS.some((c) => c.id === pveContent);

  if (!isPvp) {
    return (
      <GamePanelShell
        title={title}
        subtitle="Solo for now — coop comes later."
        onClose={onClose}
        footer={
          <>
            <button type="button" className="bb-btn-ink" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="bb-btn-brass disabled:opacity-45"
              disabled={!canEnterPve}
              onClick={() => onConfirm("pve", { content: pveContent })}
            >
              Enter
            </button>
          </>
        }
      >
        <div className="space-y-2">
          {PVE_PORTAL_CONTENTS.map((opt) => {
            const on = pveContent === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={["bb-choice", on ? "bb-choice--on" : ""].join(" ")}
                onClick={() => setPveContent(opt.id)}
              >
                <span
                  className="text-[0.95rem] font-semibold"
                  style={{ fontFamily: "var(--bb-font-display)" }}
                >
                  {opt.label}
                </span>
                <span className="bb-meta mt-1 block">{opt.description}</span>
              </button>
            );
          })}
        </div>
      </GamePanelShell>
    );
  }

  return (
    <GamePanelShell
      title={title}
      subtitle="Pick the arena modes you want to queue for."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="bb-btn-ink" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="bb-btn-brass disabled:opacity-45"
            disabled={!canEnterPvp || modes.length === 0}
            onClick={() => onConfirm("pvp", { modes })}
          >
            Open party lobby
          </button>
        </>
      }
    >
      <div className="space-y-2">
        {PVP_PORTAL_MODES.map((opt) => {
          const fits = pvpModeFitsPlayerCount(opt.id, hubPlayerCount);
          const on = modes.includes(opt.id);
          const cap = pvpModeCapacity(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={!fits}
              title={
                fits
                  ? undefined
                  : `Need a larger mode (${hubPlayerCount} in room, max ${cap})`
              }
              className={[
                "bb-choice",
                on ? "bb-choice--on" : "",
                !fits ? "opacity-40" : "",
              ].join(" ")}
              onClick={() => {
                if (!fits) return;
                setModes((prev) =>
                  prev.includes(opt.id)
                    ? prev.filter((x) => x !== opt.id)
                    : [...prev, opt.id],
                );
              }}
            >
              <span
                className="text-[0.95rem] font-semibold"
                style={{ fontFamily: "var(--bb-font-display)" }}
              >
                {opt.label}
              </span>
              {!fits ? (
                <span className="bb-meta mt-1 block">too small for this hub</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </GamePanelShell>
  );
}
