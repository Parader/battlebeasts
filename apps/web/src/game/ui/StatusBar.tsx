import { useEffect, useState, useCallback } from "react";
import { Room } from "colyseus.js";
import { STATUSES, type StatusDef } from "@battlebeasts/shared";

type StatusHudRow = {
  statusId: string;
  stacks: number;
  expiresAt: number;
  startedAt: number;
  key: string;
};

function readStatuses(room: Room | null, sessionId: string | null): StatusHudRow[] {
  if (!room || !sessionId) return [];
  const player = room.state?.players?.get(sessionId) as
    | {
        statuses?: {
          forEach: (
            cb: (
              row: { statusId: string; stacks: number; expiresAt: number; startedAt?: number; sourceId?: string },
              key?: string,
            ) => void,
          ) => void;
        };
      }
    | undefined;
  const map = player?.statuses;
  if (!map) return [];
  const rows: StatusHudRow[] = [];
  map.forEach((row, key) => {
    if (row?.statusId) {
      rows.push({
        statusId: row.statusId,
        stacks: row.stacks ?? 1,
        expiresAt: row.expiresAt ?? 0,
        startedAt: row.startedAt ?? 0,
        key: typeof key === "string" ? key : `${row.statusId}:${row.sourceId ?? ""}`,
      });
    }
  });
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows;
}

function describeStatus(def: StatusDef, row: StatusHudRow): string {
  const parts: string[] = [];
  if (def.moveMul !== undefined && def.moveMul !== 1) {
    const pct = Math.round((def.moveMul - 1) * 100);
    parts.push(pct > 0 ? `+${pct}% move speed` : `${pct}% move speed`);
  }
  if ((def as any).anticipationMul !== undefined && (def as any).anticipationMul !== 1) {
    const pct = Math.round(((def as any).anticipationMul - 1) * 100);
    parts.push(pct < 0 ? `${Math.abs(pct)}% faster cast windup` : `+${pct}% cast windup`);
  }
  if (
    row.statusId !== "bloodPactEmpower" &&
    row.statusId !== "suppressedControl" &&
    (def as any).damageDealtMul !== undefined &&
    (def as any).damageDealtMul !== 1
  ) {
    const pct = Math.round(((def as any).damageDealtMul - 1) * 100);
    parts.push(`+${pct}% damage dealt`);
  }
  if ((def as any).damageTakenMul !== undefined && (def as any).damageTakenMul !== 1) {
    const pct = Math.round(((def as any).damageTakenMul - 1) * 100);
    parts.push(pct > 0 ? `+${pct}% damage taken` : `${pct}% damage taken`);
  }
  if (def.mechanic === "stun") parts.push("Stunned");
  if (def.mechanic === "root" && row.statusId !== "bindingRooted") parts.push("Rooted");
  if (row.statusId === "bindingRooted") parts.push("Bound in place");
  if (def.mechanic === "silence") parts.push("Silenced");
  if (row.statusId === "frostChill") parts.push(`${row.stacks * 10}% slow`);
  if (row.statusId === "soulRelayLinked") {
    parts.push("Next direct hit heals for damage dealt");
  }
  if (row.statusId === "cloaked") {
    parts.push("Invisible to enemies");
  }
  if (row.statusId === "ironGuard") {
    parts.push("65% damage reduction · small shield · immune to displacement");
  }
  if (row.statusId === "hexAnchored") {
    parts.push("Next spell roots and deals damage");
  }
  if (row.statusId === "spellbreakerCharge") {
    parts.push(
      `${row.stacks} orb${row.stacks === 1 ? "" : "s"} — bonus damage on next damaging spell`,
    );
  }
  if (row.statusId === "gravityFieldSlow") {
    parts.push("45% slower in the gravity ring");
  }
  if (row.statusId === "bloodPactEmpower") {
    const pct = Math.round((((def as any).damageDealtMul ?? 1.35) - 1) * 100);
    parts.push(`+${pct}% damage dealt`);
  }
  if (row.statusId === "conductiveSurge") {
    parts.push("+15% move speed · faster casts");
  }
  if (row.statusId === "feared" || def.mechanic === "fear") {
    parts.push("Feared · fleeing and cannot cast");
  }
  if (row.statusId === "ascendantForm") {
    parts.push("22% damage reduction · enlarged presence · damage aura");
  }
  if (row.statusId === "dreadAuraActive") {
    parts.push("Reactive fear aura · enemies who cast inside are feared");
  }
  if (row.statusId === "shocked") {
    parts.push(`Shocked (${row.stacks}/3) · next hit jumps a bolt to a nearby enemy`);
  }
  if (row.statusId === "electrified") {
    parts.push("Next attack inflicts Shocked on target");
  }
  if (row.statusId === "battleInstinct") {
    parts.push("+9% damage dealt at close range");
  }
  if (row.statusId === "relentlessAssault") {
    parts.push("Next offensive ability has 20% reduced cooldown");
  }
  if (row.statusId === "impactCatalyst") {
    parts.push("Next elemental ability applies doubled status stacks");
  }
  if (row.statusId === "executionersRhythm") {
    parts.push(`+${row.stacks * 8}% close-range damage (${row.stacks}/3 stacks)`);
  }
  if (row.statusId === "sniperFocus") {
    parts.push(`${row.stacks}/2 stacks · 3rd long-range hit is guaranteed crit`);
  }
  if (row.statusId === "exposedAngle") {
    parts.push("+20% damage taken from exposed flank");
  }
  if (row.statusId === "elementalSurge") {
    parts.push("+15% elemental damage dealt (3+ enemy elemental stacks)");
  }
  if (row.statusId === "speedPickup") {
    parts.push("+50% move speed surge");
  }
  if (row.statusId === "powerPickup") {
    parts.push("+50% damage surge");
  }
  if (row.statusId === "absorbPickup") {
    parts.push(`Absorb shield (${row.stacks} HP remaining)`);
  }
  if (row.statusId === "hastePickup") {
    parts.push("Cooldown recovery haste");
  }
  if (row.statusId === "hardened") {
    parts.push(`Hardened (${row.stacks} stacks) · stacking damage reduction`);
  }
  if (row.statusId === "guardDisciplineShield") {
    parts.push(`Guard Discipline shield (${row.stacks} HP)`);
  }
  if (row.statusId === "sharedProtectionShield") {
    parts.push(`Shared Protection shield (${row.stacks} HP)`);
  }
  if (row.statusId === "frontlineSupportShield") {
    parts.push(`Frontline Support shield (${row.stacks} HP)`);
  }
  if (row.statusId === "guardiansBlessingShield") {
    parts.push(`Guardian's Blessing shield (${row.stacks} HP)`);
  }
  if (row.statusId === "underPressure") {
    parts.push("Under Pressure · damage reduction against focused attacker");
  }
  if (row.statusId === "bracedAssault") {
    parts.push("+20% damage on next close-range hit");
  }
  if (row.statusId === "guardiansPresence") {
    parts.push("+5% damage reduction (near ally)");
  }
  if (row.statusId === "aegisMomentum") {
    parts.push("+10% move speed · +10% damage dealt");
  }
  if (row.statusId === "fortifiedResolve") {
    parts.push("Next attack deals 50% less damage");
  }
  if (row.statusId === "bastion") {
    parts.push("+12% damage reduction (Bastion bond)");
  }
  if (row.statusId === "perfectDefense") {
    parts.push("+25% passive block chance");
  }
  if (row.statusId === "forbiddenGround") {
    parts.push("10% slower casts");
  }
  if (row.statusId === "suppressedControl") {
    parts.push("−12% damage dealt");
  }
  if (row.statusId === "brokenCadence") {
    parts.push("Next control ability has reduced cooldown");
  }
  if (row.statusId === "chainPullReady") {
    parts.push("Next displacement +20% stronger");
  }
  if (row.statusId === "distortedWakeSlow") {
    parts.push("20% slower in the wake");
  }
  if (row.statusId === "repositioningReady") {
    parts.push("Next attacker is rooted");
  }
  if (row.statusId === "arcaneLocked") {
    parts.push("Subsequent CC from this caster lasts longer");
  }
  if (row.statusId === "punishingSilence") {
    parts.push("+15% move speed");
  }
  if (row.statusId === "contained") {
    parts.push("Dash distance and haste bonuses reduced");
  }
  if (row.statusId === "spatiallyUnstable") {
    parts.push("Next movement ability roots on arrival");
  }
  if (row.statusId === "fleetFooted") {
    parts.push(`+${row.stacks}% move speed`);
  }
  if (row.statusId === "combatFlow") {
    parts.push(`Next damaging spell ${row.stacks}% faster`);
  }
  if (row.statusId === "followThrough") {
    parts.push(`Next damaging spell +${row.stacks}% range`);
  }
  if (row.statusId === "quickRecovery") {
    parts.push("Next defensive or movement cooldown reduced");
  }
  if (row.statusId === "untouchable") {
    parts.push("15% damage reduction · incoming CC shorter");
  }
  if (row.statusId === "reboundWindow") {
    parts.push("First direct hit refunds movement cooldown");
  }
  if (row.statusId === "movementRepeatReady") {
    parts.push("Recast the same Space movement");
  }
  if (row.statusId === "tripleBlinkReady") {
    parts.push(`Recast Space (${row.stacks} hop${row.stacks === 1 ? "" : "s"} left)`);
  }
  if (row.statusId === "motionEcho") {
    parts.push("Next different movement travels farther");
  }
  if (row.statusId === "phaseShield") {
    parts.push(`Phase Shield (${row.stacks} HP)`);
  }
  if (row.statusId === "momentumEngine") {
    parts.push("movement cooldowns recover faster");
  }
  if (row.statusId === "phantomCharge") {
    parts.push(`${row.stacks}/3 phantom charges`);
  }
  if (row.statusId === "flowEngage") {
    parts.push(
      "Deal or take damage to gain Relentless Pursuit / Momentum Engine haste",
    );
  }
  if (row.statusId === "empathicSurge") {
    parts.push(`+${row.stacks}% move speed`);
  }
  if (row.statusId === "inspiringRecovery") {
    parts.push("+8% cast speed");
  }
  if (row.statusId === "upliftingPresence") {
    parts.push("+7% move speed (your healer's HoT)");
  }
  if (row.statusId === "lastingRescue") {
    parts.push("12% damage reduction");
  }
  if (row.statusId === "overflowingGraceHot") {
    parts.push(`HoT (${row.stacks} per tick)`);
  }
  if (row.statusId === "harmoniousGrowth") {
    parts.push("+10% move · +10% cast speed");
  }
  if (row.statusId === "empoweredRecovery") {
    parts.push("+10% damage · +8% cast speed");
  }
  if (row.statusId === "battleRhythm") {
    parts.push(`+${row.stacks * 3}% move and cast speed (${row.stacks}/3)`);
  }
  if (row.statusId === "harmonyResonanceStacks") {
    parts.push(`Resonance ${row.stacks}/3`);
  }
  if (row.statusId === "harmonyResonance") {
    parts.push("+12% damage · +10% damage reduction");
  }
  if (row.statusId === "lastingGrace") {
    parts.push("Cannot fall below 1 health");
  }
  if (row.statusId === "rebirthBlessing") {
    parts.push("Will resurrect if slain");
  }
  if (row.statusId === "rebirthPending") {
    parts.push("Resurrecting");
  }
  if (row.statusId === "disoriented") {
    parts.push("Movement input reversed");
  }
  if (row.statusId === "fifthSpellCadence") parts.push(`${row.stacks}/5 stacks`);
  if (parts.length === 0) {
    if (def.description) {
      parts.push(def.description);
    } else if (def.mechanic === "shield") {
      parts.push("Absorbs incoming damage");
    } else if (def.mechanic === "dot") {
      parts.push("Damage over time");
    } else if (def.mechanic === "hot") {
      parts.push("Healing over time");
    } else if (def.mechanic === "stealth") {
      parts.push("Invisible to enemies");
    } else if (def.mechanic === "empower") {
      parts.push("Deals extra damage");
    } else if (def.mechanic === "resist") {
      parts.push("Takes less damage");
    } else if (def.mechanic === "haste") {
      parts.push("Moving faster");
    } else if (def.mechanic === "slow") {
      parts.push("Moving slower");
    } else {
      parts.push(def.polarity === "buff" ? "Beneficial effect" : "Harmful effect");
    }
  }
  return parts.join(" · ");
}

function StatusTooltip({ def, row, now }: { def: StatusDef; row: StatusHudRow; now: number }) {
  const permanent = (def as any).permanent === true || def.durationMs <= 0;
  const isAura = (def as any).isAura === true || row.statusId === "gravityFieldSlow";
  const left = permanent || isAura ? 0 : Math.max(0, row.expiresAt - now);
  return (
    <div
      className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[16.5rem] -translate-x-1/2"
      style={{ fontFamily: "var(--bb-font-display)" }}
    >
      <div
        className="rounded px-2.5 py-1.5 shadow-lg"
        style={{
          background: "rgba(12, 12, 18, 0.94)",
          border: `1px solid ${def.color}88`,
          backdropFilter: "blur(6px)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-bold"
            style={{ color: def.color }}
          >
            {def.name}
          </span>
          <span
            className="text-[9px] font-semibold uppercase"
            style={{ color: def.polarity === "buff" ? "#86efac" : "#fca5a5" }}
          >
            {def.polarity}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] leading-tight text-[#d4cbb3]">
          {describeStatus(def, row)}
        </div>
        {!permanent && !isAura && (
          <div className="mt-1 text-[9px] text-[#a09880]">
            {(left / 1000).toFixed(1)}s remaining
          </div>
        )}
        {isAura && (
          <div className="mt-1 text-[9px] text-[#a09880]">
            {row.statusId === "guardiansPresence"
              ? "Active while near an ally"
              : "Active while in area"}
          </div>
        )}
      </div>
    </div>
  );
}

export function StatusBar({ room, sessionId }: { room: Room | null; sessionId: string | null }) {
  const [rows, setRows] = useState<StatusHudRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      setRows(readStatuses(room, sessionId));
    }, 100);
    return () => window.clearInterval(id);
  }, [room, sessionId]);

  const onEnter = useCallback((key: string) => setHoveredKey(key), []);
  const onLeave = useCallback(() => setHoveredKey(null), []);

  if (rows.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[14.75rem] z-10 flex justify-center">
      <div className="bb-ability-tray !gap-1 !px-2 !py-1.5">
        {rows.map((row) => {
          const def = STATUSES[row.statusId];
          if (!def) return null;
          const permanent = (def as any).permanent === true || def.durationMs <= 0;
          const isAura = (def as any).isAura === true || row.statusId === "gravityFieldSlow";
          const left = permanent || isAura ? 0 : Math.max(0, row.expiresAt - now);
          const appliedSpan =
            row.startedAt > 0 && row.expiresAt > row.startedAt
              ? row.expiresAt - row.startedAt
              : 0;
          const total = Math.max(1, appliedSpan || def.durationMs);
          const frac = permanent ? 0 : isAura ? 1 : Math.min(1, left / total);
          const showStacks =
            row.statusId === "fifthSpellCadence" ||
            row.statusId === "soulMarked" ||
            row.statusId === "frostChill" ||
            row.statusId === "spellbreakerCharge" ||
            row.stacks > 1;
          const hovered = hoveredKey === row.key;
          return (
            <div
              key={row.key}
              className={`pointer-events-auto relative flex h-9 w-9 cursor-default flex-col items-center justify-center overflow-visible ${
                def.polarity === "buff" ? "bb-status-buff-appear" : "bb-status-icon-appear"
              }`}
              style={{
                backgroundColor: `${def.color}44`,
                border: hovered
                  ? `1.5px solid ${def.color}`
                  : "1.5px solid var(--bb-brass-dim)",
                borderRadius: 3,
                fontFamily: "var(--bb-font-display)",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={() => onEnter(row.key)}
              onMouseLeave={onLeave}
            >
              <span
                className="text-[10px] font-bold drop-shadow"
                style={{
                  color: row.statusId === "soulRelayLinked" ? "#d1fae5" : "#f3e6c0",
                  fontSize: row.statusId === "soulRelayLinked" ? 14 : 10,
                  lineHeight: 1,
                }}
              >
                {row.statusId === "soulRelayLinked" ? "+" : def.tag}
              </span>
              {showStacks && (
                <span className="absolute right-0.5 top-0 text-[9px] font-bold text-[#f3e6c0]">
                  {row.stacks}
                </span>
              )}
              {!permanent && !isAura && (
                <div
                  className="absolute bottom-0 left-0 h-0.5 bg-[#c9b27a]"
                  style={{ width: `${frac * 100}%` }}
                />
              )}
              {hovered && <StatusTooltip def={def} row={row} now={now} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
