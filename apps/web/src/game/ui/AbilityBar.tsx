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
import { talentModLines } from "./abilityTalentMods";
import { SpellSlotGlyph } from "./InputGlyph";
import { SpellIcon } from "./SpellIcon";
import { abilityHudRuntime } from "../abilityHudRuntime";
import { abilityHoverRuntime } from "../abilityHoverRuntime";
import { WalletDisplay } from "./CoinDisplay";

type Props = {
  loadout: string[];
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

export function AbilityBar({ loadout, wallet, talentIds = [], talentBuild }: Props) {
  const slots = normalizeLoadout(loadout);
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
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex items-end justify-center gap-2 px-3">
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
      {wallet ? (
        <div className="bb-hud-wallet" aria-label="Currency">
          <WalletDisplay wallet={wallet} neutralText />
        </div>
      ) : null}
    </div>
  );
}
