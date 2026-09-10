import { useState } from "react";
import {
  PVE_PORTAL_CONTENTS,
  PVP_FAMILIES,
  pvpFamilyFitsPlayerCount,
  type PvpFamily,
} from "@battlebeasts/shared";
import { GamePanelShell } from "./GamePanelShell";

type Props = {
  kind: "portal_pvp" | "portal_pve";
  onClose: () => void;
  hubPlayerCount?: number;
  onConfirm: (
    portal: "pvp" | "pve",
    params: { family?: PvpFamily; modes?: string[]; content?: string; modifiers?: string[] },
  ) => void;
  /** Fighters need a full 7-spell bar before queueing. Lobby can still open. */
  loadoutReady?: boolean;
};

export function PortalPanel({
  kind,
  onClose,
  onConfirm,
  hubPlayerCount = 1,
  loadoutReady = true,
}: Props) {
  const [family, setFamily] = useState<PvpFamily>("skirmish");
  const [pveContent, setPveContent] = useState(
    () => PVE_PORTAL_CONTENTS[0]?.id ?? "dungeon",
  );

  const isPvp = kind === "portal_pvp";
  const title = isPvp ? "Play" : "PvE / Coop Portal";
  const familyFits = pvpFamilyFitsPlayerCount(family, hubPlayerCount);
  const canEnterPve = !isPvp && PVE_PORTAL_CONTENTS.some((c) => c.id === pveContent);

  if (!isPvp) {
    return (
      <GamePanelShell
        title={title}
        subtitle={
          loadoutReady
            ? "Open a Wave Assault lobby — solo or up to 4 hunters."
            : "Slot a spell on every key at the House before you can start."
        }
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
              Open party lobby
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
      subtitle={
        loadoutReady
          ? "Pick a playlist. Matchmaking sizes the match from who’s queued."
          : "Slot a spell on every key at the House before you can queue."
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="bb-btn-ink" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="bb-btn-brass disabled:opacity-45"
            disabled={!familyFits}
            onClick={() => onConfirm("pvp", { family })}
          >
            Open lobby
          </button>
        </>
      }
    >
      <div className="space-y-2">
        {PVP_FAMILIES.map((opt) => {
          const fits = pvpFamilyFitsPlayerCount(opt.id, hubPlayerCount);
          const on = family === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={!fits}
              className={[
                "bb-choice",
                on ? "bb-choice--on" : "",
                !fits ? "opacity-40" : "",
              ].join(" ")}
              onClick={() => {
                if (fits) setFamily(opt.id);
              }}
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
