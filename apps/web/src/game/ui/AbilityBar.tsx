import { useEffect, useMemo, useState } from "react";
import {
  ABILITIES,
  SPELL_SLOTS,
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
import { talentModLines } from "./abilityTalentMods";
import { KeyGlyph, SpellSlotGlyph } from "./InputGlyph";
import { SpellIcon } from "./SpellIcon";
import { abilityHudRuntime } from "../abilityHudRuntime";
import { abilityHoverRuntime } from "../abilityHoverRuntime";
import { WalletDisplay } from "./CoinDisplay";

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
};

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

function SlotIcon({
  ability,
  abilityId,
  slot,
  remainingMs,
  flash,
  statsLine,
  modLines,
  onHover,
}: {
  ability: AbilityDef | undefined;
  abilityId: string | undefined;
  slot: SpellSlot;
  remainingMs: number;
  flash: boolean;
  statsLine: string;
  modLines: string[];
  onHover: (id: string | null) => void;
}) {
  const cooling = remainingMs > 0;
  const frac =
    ability && ability.cooldownMs > 0 ? Math.min(1, remainingMs / ability.cooldownMs) : 0;

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
        ]
          .filter(Boolean)
          .join(" ")}
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
          <p className="bb-ability-tooltip__stats">{statsLine}</p>
          {modLines.length > 0 ? (
            <ul className="bb-ability-tooltip__mods">
              {modLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
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
  flash,
  affordable,
  cost,
  statsLine,
  modLines,
  locked,
  onHover,
}: {
  ability: AbilityDef | undefined;
  index: number;
  remainingMs: number;
  flash: boolean;
  affordable: boolean;
  cost: number;
  statsLine: string;
  modLines: string[];
  locked: boolean;
  onHover: (id: string | null) => void;
}) {
  const cooling = remainingMs > 0;
  const frac =
    ability && ability.cooldownMs > 0 ? Math.min(1, remainingMs / ability.cooldownMs) : 0;

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
        {locked ? null : (
          <span className="bb-flex-slot__glyph">
            <KeyGlyph label={String(index + 1)} size={15} />
          </span>
        )}
      </div>
      {locked ? (
        <div className="bb-ability-tooltip" role="tooltip">
          <p className="bb-ability-tooltip__name">Flex slot {index + 1}</p>
          <p className="bb-ability-tooltip__desc">Unlock with essence at the Spell Armoury.</p>
        </div>
      ) : null}
      {ability ? (
        <div className="bb-ability-tooltip" role="tooltip">
          <p className="bb-ability-tooltip__name">{ability.name}</p>
          {ability.description ? (
            <p className="bb-ability-tooltip__desc">{ability.description}</p>
          ) : null}
          <p className="bb-ability-tooltip__stats">{statsLine}</p>
          <p className="bb-ability-tooltip__cost">
            {cost} Energy{affordable ? "" : " — not enough"}
          </p>
          {modLines.length > 0 ? (
            <ul className="bb-ability-tooltip__mods">
              {modLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AbilityBar({
  loadout,
  flexLoadout,
  flexSlotCount = 1,
  energy = 0,
  wallet,
  talentIds = [],
  talentBuild,
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

  const kit = useMemo(
    () => resolveKit(slots.filter(Boolean).join(","), talentIds, talentBuild),
    [slots, talentIds, talentBuild],
  );

  useEffect(() => {
    return abilityHudRuntime.subscribe(() => {
      setCooldownUntil(abilityHudRuntime.cooldownUntil);
      setFlashId(abilityHudRuntime.flashId);
    });
  }, []);

  useEffect(() => {
    return () => abilityHoverRuntime.clear();
  }, []);

  const needsTick = Object.values(cooldownUntil).some((t) => t > Date.now() - 50);
  const now = useNow(needsTick);

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
              flash={Boolean(id && flashId === id)}
              affordable={wholePips >= cost}
              cost={cost}
              statsLine={statsLine}
              modLines={ability ? talentModLines(ability, kit) : []}
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
              flash={Boolean(id && flashId === id)}
              statsLine={statsLine}
              modLines={ability ? talentModLines(ability, kit) : []}
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
