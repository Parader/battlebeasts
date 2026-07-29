import { useEffect, useState } from "react";
import {
  ABILITIES,
  SPELL_SLOTS,
  normalizeLoadout,
  type AbilityDef,
  type SpellSlot,
  type Wallet,
} from "@battlebeasts/shared";
import { SpellSlotGlyph } from "./InputGlyph";
import { abilityHudRuntime } from "../abilityHudRuntime";
import { WalletDisplay } from "./CoinDisplay";

type Props = {
  loadout: string[];
  wallet?: Pick<Wallet, "copper" | "silver" | "gold" | "essence" | "rubies">;
};

const SHAPE_TINT: Record<string, string> = {
  projectile: "#3d8fb5",
  melee: "#c4703a",
  dash: "#6a9a45",
  aoe: "#7a6aad",
  buff: "#4a9a9a",
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
  slot,
  remainingMs,
  flash,
}: {
  ability: AbilityDef | undefined;
  slot: SpellSlot;
  remainingMs: number;
  flash: boolean;
}) {
  const cooling = remainingMs > 0;
  const frac =
    ability && ability.cooldownMs > 0 ? Math.min(1, remainingMs / ability.cooldownMs) : 0;
  const tint = ability ? (SHAPE_TINT[ability.shape] ?? "#6b7280") : "#3f463f";

  return (
    <div
      className={["bb-ability-slot", flash ? "bb-ability-slot--flash" : ""].join(" ")}
      style={{
        background: `linear-gradient(165deg, ${tint}99 0%, #0c100e 58%)`,
      }}
      title={ability ? `${ability.name}` : slot.label}
    >
      <span className="bb-ability-slot__name">{ability?.name ?? "—"}</span>
      {cooling && (
        <>
          <div
            className="absolute inset-0 bg-[rgba(236,224,188,0.48)]"
            style={{ clipPath: `inset(${(1 - frac) * 100}% 0 0 0)` }}
          />
          <span
            className="absolute inset-0 z-[1] flex items-center justify-center text-sm font-bold tabular-nums text-[var(--bb-ink)]"
            style={{ fontFamily: "var(--bb-font-display)", textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
          >
            {Math.ceil(remainingMs / 1000)}
          </span>
        </>
      )}
      <span className="bb-ability-slot__glyph">
        <SpellSlotGlyph slot={slot} size={slot.input === "space" ? 18 : 20} />
      </span>
    </div>
  );
}

export function AbilityBar({ loadout, wallet }: Props) {
  const slots = normalizeLoadout(loadout);
  const [cooldownUntil, setCooldownUntil] = useState(() => abilityHudRuntime.cooldownUntil);
  const [flashId, setFlashId] = useState(() => abilityHudRuntime.flashId);

  useEffect(() => {
    return abilityHudRuntime.subscribe(() => {
      setCooldownUntil(abilityHudRuntime.cooldownUntil);
      setFlashId(abilityHudRuntime.flashId);
    });
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
          return (
            <SlotIcon
              key={slot.id}
              ability={ability}
              slot={slot}
              remainingMs={Math.max(0, until - now)}
              flash={Boolean(id && flashId === id)}
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
