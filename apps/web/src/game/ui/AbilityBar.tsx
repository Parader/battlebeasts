import { useEffect, useState } from "react";
import { ABILITIES, SPELL_SLOTS, normalizeLoadout, type AbilityDef } from "@battlebeasts/shared";

type Props = {
    loadout: string[];
    /** abilityId → ready-at epoch ms (client-predicted until server owns CDs). */
    cooldownUntil: Record<string, number>;
    flashId?: string | null;
};

const SHAPE_TINT: Record<string, string> = {
    projectile: "#38bdf8",
    melee: "#fb923c",
    dash: "#a3e635",
    aoe: "#c084fc",
    buff: "#f472b6",
};

function useNow(tick: boolean) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!tick) return;
        let raf = 0;
        let lastShown = 0;
        const loop = (t: number) => {
            // ~30 UI updates/sec is enough for CD sweep without React spam
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
    shortcut,
    remainingMs,
    flash,
}: {
    ability: AbilityDef | undefined;
    shortcut: string;
    remainingMs: number;
    flash: boolean;
}) {
    const cooling = remainingMs > 0;
    const frac =
        ability && ability.cooldownMs > 0 ? Math.min(1, remainingMs / ability.cooldownMs) : 0;
    const tint = ability ? (SHAPE_TINT[ability.shape] ?? "#94a3b8") : "#64748b";

    return (
        <div
            className={[
                "relative flex h-14 w-14 flex-col items-center justify-end overflow-hidden rounded-md ring-2",
                flash ? "ring-white scale-105" : "ring-white/40",
            ].join(" ")}
            style={{
                background: `linear-gradient(180deg, ${tint}55 0%, #0f172aee 55%)`,
            }}
            title={ability ? `${ability.name} (${shortcut})` : shortcut}
        >
            <span className="pointer-events-none absolute inset-x-0 top-1.5 px-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-white drop-shadow">
                {ability?.name ?? "—"}
            </span>
            {cooling && (
                <>
                    {/* Light frost overlay — readable on dark slots */}
                    <div
                        className="absolute inset-0 bg-sky-100/75"
                        style={{ clipPath: `inset(${(1 - frac) * 100}% 0 0 0)` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-slate-900 tabular-nums drop-shadow-sm">
                        {Math.ceil(remainingMs / 1000)}
                    </span>
                </>
            )}
            <span className="relative z-10 mb-0.5 rounded bg-slate-950/80 px-1.5 text-[10px] font-bold text-amber-200 ring-1 ring-amber-200/40">
                {shortcut}
            </span>
        </div>
    );
}

export function AbilityBar({ loadout, cooldownUntil, flashId }: Props) {
    const slots = normalizeLoadout(loadout);
    const needsTick = Object.values(cooldownUntil).some((t) => t > Date.now() - 50);
    const now = useNow(needsTick);

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center">
            <div className="flex items-end gap-1.5 rounded-xl bg-slate-950/70 px-3 py-2 backdrop-blur-sm ring-1 ring-white/20">
                {SPELL_SLOTS.map((slot, i) => {
                    const id = slots[i];
                    const ability = id ? ABILITIES[id] : undefined;
                    const until = id ? (cooldownUntil[id] ?? 0) : 0;
                    return (
                        <SlotIcon
                            key={slot.id}
                            ability={ability}
                            shortcut={slot.label}
                            remainingMs={Math.max(0, until - now)}
                            flash={Boolean(flashId && flashId === id)}
                        />
                    );
                })}
            </div>
        </div>
    );
}
