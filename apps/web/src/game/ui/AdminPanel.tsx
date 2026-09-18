import { useEffect, useMemo, useState } from "react";
import {
  listMaps,
  normalizeCosmeticBody,
  PVE_CONTENTS,
  PVP_MODES,
  type CosmeticBodyId,
} from "@battlebeasts/shared";
import { setAdminThirdPerson, useAdminThirdPerson } from "../adminThirdPerson";
import { setAdminBindPose, useAdminBindPose } from "../adminBindPose";
import { GamePanelShell } from "./GamePanelShell";
import { VesselPicker } from "./VesselPicker";

type ChestQuality = "green" | "blue" | "purple" | "legendary";

type Props = {
  open: boolean;
  onClose: () => void;
  onSpawnChest?: (quality: ChestQuality) => void;
  onReplayIntro?: () => void;
  onSoftResetCharacter?: () => void;
  /** Admin hub practice — skip ability cooldowns. */
  adminNoCooldown?: boolean;
  onToggleAdminNoCooldown?: (enabled: boolean) => void;
  /** Drop into any registered map solo, for looking at authored maps. */
  onTpToMap?: (mapId: string) => void;
  /** Jump straight into a live mode (KoTH / Domination / CTF / skirmish / Wave Assault). */
  onEnterMode?: (modeId: string) => void;
  vessel?: string;
  onSetVessel?: (vessel: "female" | "male") => void;
};

const ADMIN_QUALITIES: readonly ChestQuality[] = ["green", "blue", "purple", "legendary"];

/** Hub admin tools — spawn chests, intro replay, soft reset, cooldowns. */
export function AdminPanel({
  open,
  onClose,
  onSpawnChest,
  onReplayIntro,
  onSoftResetCharacter,
  adminNoCooldown = false,
  onToggleAdminNoCooldown,
  onTpToMap,
  onEnterMode,
  vessel,
  onSetVessel,
}: Props) {
  const [spawnQuality, setSpawnQuality] = useState<ChestQuality>("blue");
  const [adminVessel, setAdminVessel] = useState<CosmeticBodyId>(() =>
    normalizeCosmeticBody(vessel),
  );
  useEffect(() => {
    if (vessel) setAdminVessel(normalizeCosmeticBody(vessel));
  }, [vessel]);
  // Registration happens once at startup, so the list never changes at runtime.
  const maps = useMemo(
    () => listMaps().filter((m) => m.kind === "doc").sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const [mapId, setMapId] = useState(() => maps[0]?.id ?? "");
  const modes = useMemo(
    () => [
      ...PVP_MODES.filter((m) => m.enabled).map((m) => ({ id: m.id, label: m.label })),
      ...PVE_CONTENTS.filter((c) => c.enabled).map((c) => ({ id: c.id, label: c.label })),
    ],
    [],
  );
  const [modeId, setModeId] = useState(() => modes.find((m) => m.id === "bg_koth")?.id ?? modes[0]?.id ?? "");
  const thirdPerson = useAdminThirdPerson();
  const bindPose = useAdminBindPose();

  if (!open) return null;

  return (
    <GamePanelShell
      title="Admin"
      subtitle="Hub tools for testing and support"
      onClose={onClose}
      maxHeightClass="max-h-[min(80dvh,560px)]"
    >
      <section className="space-y-2">
        {onSetVessel ? (
          <div className="bb-list-row">
            <VesselPicker
              value={adminVessel}
              onChange={(id) => {
                setAdminVessel(id);
                onSetVessel(id);
              }}
            />
          </div>
        ) : null}
        {onSpawnChest ? (
          <div className="bb-list-row flex flex-wrap items-center gap-2">
            <select
              className="bb-input"
              value={spawnQuality}
              aria-label="Chest rarity"
              onChange={(e) => setSpawnQuality(e.target.value as ChestQuality)}
            >
              {ADMIN_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bb-btn-brass"
              onClick={() => onSpawnChest(spawnQuality)}
            >
              Get chest
            </button>
          </div>
        ) : null}
        <div className="bb-list-row flex flex-wrap items-center gap-2">
          {onToggleAdminNoCooldown ? (
            <button
              type="button"
              className={adminNoCooldown ? "bb-btn-brass" : "bb-btn-ink"}
              onClick={() => onToggleAdminNoCooldown(!adminNoCooldown)}
            >
              {adminNoCooldown ? "Cooldowns OFF" : "Disable cooldowns"}
            </button>
          ) : null}
          <button
            type="button"
            className={bindPose ? "bb-btn-brass" : "bb-btn-ink"}
            onClick={() => setAdminBindPose(!bindPose)}
          >
            {bindPose ? "T-pose ON" : "Force T-pose"}
          </button>
          <button
            type="button"
            className={thirdPerson ? "bb-btn-brass" : "bb-btn-ink"}
            onClick={() => setAdminThirdPerson(!thirdPerson)}
          >
            {thirdPerson ? "3rd person ON" : "3rd person view"}
          </button>
          {onReplayIntro ? (
            <button type="button" className="bb-btn-ink" onClick={onReplayIntro}>
              Replay intro
            </button>
          ) : null}
          {onSoftResetCharacter ? (
            <button type="button" className="bb-btn-ink" onClick={onSoftResetCharacter}>
              Soft reset character
            </button>
          ) : null}
        </div>
        {onTpToMap && maps.length > 0 ? (
          <div className="bb-list-row flex flex-wrap items-center gap-2">
            <select
              className="bb-input"
              value={mapId}
              aria-label="Map"
              onChange={(e) => setMapId(e.target.value)}
            >
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.kind === "doc" ? " (authored)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bb-btn-brass"
              disabled={!mapId}
              onClick={() => onTpToMap(mapId)}
            >
              Go to map
            </button>
          </div>
        ) : null}
        {onEnterMode && modes.length > 0 ? (
          <div className="bb-list-row flex flex-wrap items-center gap-2">
            <select
              className="bb-input"
              value={modeId}
              aria-label="Game mode"
              onChange={(e) => setModeId(e.target.value as (typeof modes)[number]["id"])}
            >
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bb-btn-brass"
              disabled={!modeId}
              onClick={() => onEnterMode(modeId)}
            >
              Enter mode
            </button>
          </div>
        ) : null}
      </section>
    </GamePanelShell>
  );
}
