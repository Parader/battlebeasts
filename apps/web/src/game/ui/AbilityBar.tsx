import { useEffect, useMemo, useState } from "react";
import { Room } from "colyseus.js";
import {
  ABILITIES,
  SPELL_SLOTS,
  abilityAppliedEffectNotes,
  formatAbilityArmoryStats,
  kitCooldownMs,
  normalizeLoadout,
  resolveKit,
  type AbilityDef,
  type SpellSlot,
  type TalentBuild,
  type Wallet,
} from "@battlebeasts/shared";
import {
  EMPTY_FLEX_LOADOUT,
  FLEX_SLOT_COUNT,
  flexCost,
  normalizeFlexLoadout,
  type FlexLoadout,
} from "@battlebeasts/shared";
import { talentModsForSpell, type TalentSpellMod } from "./abilityTalentMods";
import { KeyGlyph, SpellSlotGlyph } from "./InputGlyph";
import { SpellIcon } from "./SpellIcon";
import { abilityHudRuntime } from "../abilityHudRuntime";
import { abilityHoverRuntime } from "../abilityHoverRuntime";
import { WalletDisplay } from "./CoinDisplay";
import {
  resolveAbilitySlotGlow,
  statusIdsNeedSlotTick,
  type AbilitySlotGlow,
} from "./abilitySlotGlow";

type Props = {
  loadout: string[];
  flexLoadout?: FlexLoadout;
  /** How many flex slots the account has bought. Slots past this show as locked. */
  flexSlotCount?: number;
  /** Current Energy in pips, for affordability. Fractional; spending is whole. */
  energy?: number;
  wallet?: Pick<Wallet, "copper" | "silver" | "gold" | "essence" | "rubies">;
  talentIds?: string[];
  talentBuild?: TalentBuild;
  room?: Room | null;
  sessionId?: string | null;
};

function readStatusIds(room: Room | null | undefined, sessionId: string | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!room || !sessionId) return ids;
  const me = room.state?.players?.get(sessionId) as
    | { statuses?: { forEach: (cb: (row: { statusId?: string }) => void) => void } }
    | undefined;
  me?.statuses?.forEach((row) => {
    if (row?.statusId) ids.add(row.statusId);
  });
  return ids;
}

function riftSecondPlantReady(
  room: Room | null | undefined,
  sessionId: string | null | undefined,
  now: number,
): boolean {
  const portals = room?.state?.riftPortals as
    | {
        forEach: (
          cb: (raw: { ownerSessionId?: string; phase?: string; armEndsAt?: number; index?: number }) => void,
        ) => void;
      }
    | undefined;
  if (!portals || !sessionId) return false;
  let arming = false;
  portals.forEach((raw) => {
    if (raw.ownerSessionId !== sessionId) return;
    if (raw.phase !== "arming") return;
    if ((raw.index ?? 0) !== 0) return;
    if ((raw.armEndsAt ?? 0) > now) arming = true;
  });
  return arming;
}

function useNow(tick: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!tick) return;
    let raf = 0;
    let lastShown = 0;
    const loop = (t: number) => {
      if (t - lastShown >= 32) {
        lastShown = t;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tick]);
  return now;
}

function TalentModList({ mods }: { mods: TalentSpellMod[] }) {
  if (mods.length === 0) return null;
  return (
    <div className="bb-ability-tooltip__talents">
      <p className="bb-ability-tooltip__talents-label">Talents</p>
      <ul className="bb-ability-tooltip__mods">
        {mods.map((mod) => (
          <li key={`${mod.talentId}:${mod.effect}`} className={mod.live ? "is-live" : undefined}>
            <span className="bb-ability-tooltip__mod-name">
              {mod.name}
              {mod.live ? " · now" : ""}
            </span>
            <span className="bb-ability-tooltip__mod-effect">{mod.effect}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SlotIcon({
  ability,
  abilityId,
  slot,
  remainingMs,
  cooldownTotalMs,
  flash,
  glow,
  statsLine,
  mods,
  onHover,
}: {
  ability: AbilityDef | undefined;
  abilityId: string | undefined;
  slot: SpellSlot;
  remainingMs: number;
  cooldownTotalMs: number;
  flash: boolean;
  glow: AbilitySlotGlow | null;
  statsLine: string;
  mods: TalentSpellMod[];
  onHover: (id: string | null) => void;
}) {
  const cooling = remainingMs > 0;
  const frac = cooldownTotalMs > 0 ? Math.min(1, remainingMs / cooldownTotalMs) : 0;

  return (
    <div
      className="pointer-events-auto relative"
      onMouseEnter={() => onHover(abilityId ?? null)}
      onMouseLeave={() => onHover(null)}
    >
      <div
        className={[
          "bb-ability-slot",
          ability ? "bb-ability-slot--icon" : "",
          flash ? "bb-ability-slot--flash" : "",
          glow === "recast" ? "bb-ability-slot--recast" : "",
          glow === "boost" ? "bb-ability-slot--boost" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={
          glow === "recast"
            ? `${ability?.name ?? "Spell"} ready to recast`
            : glow === "boost"
              ? `${ability?.name ?? "Spell"} boosted`
              : undefined
        }
      >
        {ability ? (
          <SpellIcon
            abilityId={ability.id}
            size={58}
            className="bb-ability-slot__art"
            alt={ability.name}
          />
        ) : null}
        {cooling && (
          <>
            <div
              className="bb-ability-slot__cd-dim"
              aria-hidden
            />
            <div
              className="bb-ability-slot__cd-sweep"
              style={{ clipPath: `inset(${(1 - frac) * 100}% 0 0 0)` }}
              aria-hidden
            />
            <span className="bb-ability-slot__cd-num">
              {Math.ceil(remainingMs / 1000)}
            </span>
          </>
        )}
        {glow === "recast" ? (
          <span className="bb-ability-slot__proc" aria-hidden>
            Recast
          </span>
        ) : glow === "boost" ? (
          <span className="bb-ability-slot__proc bb-ability-slot__proc--boost" aria-hidden>
            Boost
          </span>
        ) : null}
        <span className="bb-ability-slot__glyph">
          <SpellSlotGlyph slot={slot} size={slot.input === "space" ? 18 : 20} />
        </span>
      </div>
      {ability ? (
        <div className="bb-ability-tooltip" role="tooltip">
          <p className="bb-ability-tooltip__name">{ability.name}</p>
          {ability.description ? (
            <p className="bb-ability-tooltip__desc">{ability.description}</p>
          ) : null}
          {abilityAppliedEffectNotes(ability).map((fx) => (
            <p key={fx.name} className="bb-ability-tooltip__effect">
              <strong>{fx.name}.</strong> {fx.description}
            </p>
          ))}
          <p className="bb-ability-tooltip__stats">{statsLine}</p>
          <TalentModList mods={mods} />
        </div>
      ) : (
        <div className="bb-ability-tooltip" role="tooltip">
          <p className="bb-ability-tooltip__name">Empty {slot.label}</p>
          <p className="bb-ability-tooltip__desc">
            Buy a spell at the House Spell Armoury. Every key must be filled before you can queue.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * One flex slot: a spell bought with Energy rather than owned outright.
 *
 * Deliberately smaller than a main slot and set above the tray. These are
 * situational extras, and sizing them like the core kit would misrepresent how
 * often they are live -- most of the time at least one is unaffordable.
 */
function FlexSlotIcon({
  ability,
  index,
  remainingMs,
  cooldownTotalMs,
  flash,
  glow,
  affordable,
  cost,
  statsLine,
  mods,
  locked,
  onHover,
}: {
  ability: AbilityDef | undefined;
  index: number;
  remainingMs: number;
  cooldownTotalMs: number;
  flash: boolean;
  glow: AbilitySlotGlow | null;
  affordable: boolean;
  cost: number;
  statsLine: string;
  mods: TalentSpellMod[];
  locked: boolean;
  onHover: (id: string | null) => void;
}) {
  const cooling = remainingMs > 0;
  const frac = cooldownTotalMs > 0 ? Math.min(1, remainingMs / cooldownTotalMs) : 0;

  return (
    <div
      className="pointer-events-auto relative"
      onMouseEnter={() => onHover(ability?.id ?? null)}
      onMouseLeave={() => onHover(null)}
    >
      <div
        className={[
          "bb-flex-slot",
          ability ? "bb-flex-slot--icon" : "",
          locked ? "bb-flex-slot--locked" : "",
          // Cooldown already dims the art, so the unaffordable treatment only
          // applies when the spell is otherwise ready -- two greys stacked on
          // one slot says nothing about which gate is the one blocking you.
          ability && !affordable && !cooling ? "bb-flex-slot--poor" : "",
          flash ? "bb-flex-slot--flash" : "",
          glow === "recast" ? "bb-flex-slot--recast" : "",
          glow === "boost" ? "bb-flex-slot--boost" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {ability ? (
          <SpellIcon
            abilityId={ability.id}
            size={40}
            className="bb-flex-slot__art"
            alt={ability.name}
          />
        ) : null}
        {cooling && (
          <>
            <div className="bb-ability-slot__cd-dim" aria-hidden />
            <div
              className="bb-ability-slot__cd-sweep"
              style={{ clipPath: `inset(${(1 - frac) * 100}% 0 0 0)` }}
              aria-hidden
            />
            <span className="bb-flex-slot__cd-num">{Math.ceil(remainingMs / 1000)}</span>
          </>
        )}
        {locked ? (
          <span className="bb-flex-slot__lock" aria-label="Locked flex slot">
            &#128274;
          </span>
        ) : null}
        {ability ? (
          <span className="bb-flex-slot__cost" aria-label={`${cost} energy`}>
            {cost}
          </span>
        ) : null}
        {glow === "recast" ? (
          <span className="bb-ability-slot__proc" aria-hidden>
            Recast
          </span>
        ) : glow === "boost" ? (
          <span className="bb-ability-slot__proc bb-ability-slot__proc--boost" aria-hidden>
            Boost
          </span>
        ) : null}
        {locked ? null : (
          <span className="bb-flex-slot__glyph">
            <KeyGlyph label={String(index + 1)} size={15} />
          </span>
        )}
      </div>
      {locked ? (
        <div className="bb-ability-tooltip" role="tooltip">
          <p className="bb-ability-tooltip__name">Flex slot {index + 1}</p>
          <p className="bb-ability-tooltip__desc">
            Optional extra. Unlock with essence at the Spell Armoury when you want a bigger kit.
          </p>
        </div>
      ) : !ability ? (
        <div className="bb-ability-tooltip" role="tooltip">
          <p className="bb-ability-tooltip__name">Flex slot {index + 1}</p>
          <p className="bb-ability-tooltip__desc">
            Optional extra spell — fill your main keys first. Cast with {index + 1} once slotted.
          </p>
        </div>
      ) : null}
      {ability ? (
        <div className="bb-ability-tooltip" role="tooltip">
          <p className="bb-ability-tooltip__name">{ability.name}</p>
          {ability.description ? (
            <p className="bb-ability-tooltip__desc">{ability.description}</p>
          ) : null}
          {abilityAppliedEffectNotes(ability).map((fx) => (
            <p key={fx.name} className="bb-ability-tooltip__effect">
              <strong>{fx.name}.</strong> {fx.description}
            </p>
          ))}
          <p className="bb-ability-tooltip__stats">{statsLine}</p>
          <p className="bb-ability-tooltip__cost">
            {cost} Energy{affordable ? "" : " — not enough"}
          </p>
          <TalentModList mods={mods} />
        </div>
      ) : null}
    </div>
  );
}

export function AbilityBar({
  loadout,
  flexLoadout,
  flexSlotCount = 0,
  energy = 0,
  wallet,
  talentIds = [],
  talentBuild,
  room = null,
  sessionId = null,
}: Props) {
  const slots = normalizeLoadout(loadout);
  const flex = useMemo(
    () => normalizeFlexLoadout(flexLoadout ?? EMPTY_FLEX_LOADOUT),
    [flexLoadout],
  );
  // Affordability is a whole-pip question: a slot costing 4 is not castable at
  // 3.9, and showing it as live would be a lie the player pays for mid-fight.
  const wholePips = Math.floor(energy);
  const [cooldownUntil, setCooldownUntil] = useState(() => abilityHudRuntime.cooldownUntil);
  const [flashId, setFlashId] = useState(() => abilityHudRuntime.flashId);
  const [lastFlowMoveId, setLastFlowMoveId] = useState(() => abilityHudRuntime.lastFlowMoveId);
  const [clockPausedAt, setClockPausedAt] = useState(() => abilityHudRuntime.clockPausedAt);

  const kit = useMemo(
    () => resolveKit(slots.filter(Boolean).join(","), talentIds, talentBuild),
    [slots, talentIds, talentBuild],
  );

  useEffect(() => {
    return abilityHudRuntime.subscribe(() => {
      setCooldownUntil(abilityHudRuntime.cooldownUntil);
      setFlashId(abilityHudRuntime.flashId);
      setLastFlowMoveId(abilityHudRuntime.lastFlowMoveId);
      setClockPausedAt(abilityHudRuntime.clockPausedAt);
    });
  }, []);

  useEffect(() => {
    return () => abilityHoverRuntime.clear();
  }, []);

  const statusIds = readStatusIds(room, sessionId);
  const hudNow = abilityHudRuntime.hudNow();
  const riftArming = riftSecondPlantReady(room, sessionId, hudNow);
  const clockFrozen = clockPausedAt > 0;
  const needsTick =
    !clockFrozen &&
    (Object.values(cooldownUntil).some((t) => t > Date.now() - 50) ||
      statusIdsNeedSlotTick(statusIds) ||
      riftArming);
  const liveNow = useNow(needsTick);
  const now = clockFrozen ? hudNow : liveNow;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex items-end justify-center px-3">
      {/*
        The bar is centred on the screen, not on the screen-minus-wallet. The
        wallet is taken out of flow for that reason: as a flex sibling it
        pushed the whole tray left by half its width, so the spell you reach
        for by muscle memory sat off centre.
      */}
      <div className="flex flex-col items-center gap-1.5">
      <div className="bb-flex-tray" aria-label="Flex spells">
        {Array.from({ length: FLEX_SLOT_COUNT }, (_, i) => {
          const locked = i >= flexSlotCount;
          const id = locked ? null : flex[i];
          const ability = id ? ABILITIES[id] : undefined;
          const until = id ? (cooldownUntil[id] ?? 0) : 0;
          const cost = id ? flexCost(id) : 0;
          const adjustedCd = ability
            ? kitCooldownMs(kit, ability.id, ability.cooldownMs)
            : 0;
          const statsLine = ability
            ? formatAbilityArmoryStats(ability).replace(
                /^CD [^\s]+/,
                `CD ${(adjustedCd / 1000).toFixed(adjustedCd % 1000 === 0 ? 0 : 1)}s`,
              )
            : "";
          return (
            <FlexSlotIcon
              key={i}
              ability={ability}
              index={i}
              remainingMs={Math.max(0, until - now)}
              cooldownTotalMs={adjustedCd}
              flash={Boolean(id && flashId === id)}
              glow={resolveAbilitySlotGlow(id ?? undefined, statusIds, lastFlowMoveId, riftArming)}
              affordable={wholePips >= cost}
              cost={cost}
              statsLine={statsLine}
              mods={ability ? talentModsForSpell(ability, kit, statusIds) : []}
              locked={locked}
              onHover={(hid) => abilityHoverRuntime.setHoveredAbilityId(hid)}
            />
          );
        })}
      </div>
      <div className="bb-ability-tray">
        {SPELL_SLOTS.map((slot, i) => {
          const id = slots[i];
          const ability = id ? ABILITIES[id] : undefined;
          const until = id ? (cooldownUntil[id] ?? 0) : 0;
          const adjustedCd = ability
            ? kitCooldownMs(kit, ability.id, ability.cooldownMs)
            : 0;
          const statsLine = ability
            ? formatAbilityArmoryStats(ability).replace(
                /^CD [^\s]+/,
                `CD ${(adjustedCd / 1000).toFixed(adjustedCd % 1000 === 0 ? 0 : 1)}s`,
              )
            : "";
          return (
            <SlotIcon
              key={slot.id}
              ability={ability}
              abilityId={id}
              slot={slot}
              remainingMs={Math.max(0, until - now)}
              cooldownTotalMs={adjustedCd}
              flash={Boolean(id && flashId === id)}
              glow={resolveAbilitySlotGlow(id, statusIds, lastFlowMoveId, riftArming)}
              statsLine={statsLine}
              mods={ability ? talentModsForSpell(ability, kit, statusIds) : []}
              onHover={(hid) => abilityHoverRuntime.setHoveredAbilityId(hid)}
            />
          );
        })}
      </div>
      </div>
      {wallet ? (
        <div className="bb-hud-wallet absolute bottom-0 right-3" aria-label="Currency">
          <WalletDisplay wallet={wallet} neutralText />
        </div>
      ) : null}
    </div>
  );
}
